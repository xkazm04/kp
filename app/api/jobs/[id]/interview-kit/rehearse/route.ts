// Rehearse one version of a job's interview kit (spark interview-kit-template, WP-D).
//   POST /api/jobs/[id]/interview-kit/rehearse { kitId } -> { url }   ("/interview/<token>")
//   refusals: 401 (no session — requireOperator's answer) · FORBIDDEN_CAPABILITY 403 ·
//        JOB_NOT_FOUND 404 · INTERVIEW_KIT_NOT_FOUND 404
//        (unknown, another team's, or another role's version — one answer on purpose) ·
//        PAYLOAD_TOO_LARGE 413 · INTERVIEW_KIT_INVALID 400 {reason, at} ·
//        INTERVIEW_PROVIDER_UNCONFIGURED 503 {provider, need} · BILLING_QUOTA_EXCEEDED 402
//        {meter, plan} · TOO_MANY_REQUESTS 429
import { NextRequest, NextResponse } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { meterGate } from "@/app/_lib/billing";
import { maxBillableInterviewMin } from "@/app/_lib/billing/enforce";
import { createInterviewSession } from "@/app/_lib/db/interviews";
import { canWriteJobLifecycle, getJob } from "@/app/_lib/db/jobs";
import { buildKitOnlyInterviewKit, toCandidateAgendaView } from "@/app/_lib/interview-agenda";
import { kitById } from "@/app/_lib/interview-kit";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { BODY_TOO_LARGE, readJsonWithLimit } from "@/app/_lib/request-body";
import {
  defaultInterviewerInstructions,
  getVoiceAdapter,
  isSelfHostedProvider,
  missingVoiceEnv,
  pickDefaultProvider,
  voiceAvailability,
} from "@/app/_lib/voice";
import { getServerLocale } from "@/i18n/server";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";

// A recruiter hears the REAL interviewer run a kit — its agenda, both briefs, the
// director and its tools — before any candidate meets it. The operator chose to rehearse
// the job TEMPLATE with no candidate attached, so this mints a `mode: "test"` interview
// session with NO pipeline entry, PINNED to the kit version named in the body (a draft is
// rehearsable: hearing an unpublished draft is the point), in the caller's workspace.
// /api/interview/connect directs it (interview-rehearsal.ts isKitRehearsal) and the
// ordinary public portal runs it. /api/interview/complete keeps its transcript, bills its
// minutes and scores NOTHING — a test session is never a candidate interview.
//
// Order, cheapest refusal first, and every refusal before anything is written:
//   session → capability → job ownership → a kit version of THIS job → a configured voice
//   provider → the kit directs something → the minutes reservation → the throttle →
//   the session row (the billable artifact).
// The seat is asked first so a refused seat learns nothing about which job or kit ids
// exist (the sibling kit doors' rule); an invisible job and a foreign kit are 404s, not
// 403s, for the same reason.

/** Per-IP, the /simulate budget: this door mints the same kind of billable, entry-less
 *  practice session, and on a SELF-HOSTED install it skips meterGate entirely, so there
 *  the limiter is the only bound on how many sessions one caller can mint. Capability-
 *  gated, but open mode (KP_OPERATOR_PASSWORD unset) makes that gate a documented no-op
 *  for the whole API. 20/10min: a recruiter takes one rehearsal before starting another. */
const REHEARSE_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };

/** A body of `{ kitId }` — one short field. */
const MAX_REHEARSE_BODY_BYTES = 4 * 1024;

/** The kit id the body may name, bounded at the boundary like ./publish does. */
const MAX_KIT_ID_LEN = 64;

/** The recruiter's language — what the agenda titles and the opening language of a
 *  rehearsal are written in, standing in for the language a candidate chose at apply.
 *  Stored on the session so /connect can fall back to it. Outside a request scope (a
 *  script, a unit runner) the resolver throws, and the default locale is the answer. */
async function recruiterLocale(): Promise<Locale> {
  try {
    return await getServerLocale();
  } catch {
    /* no request scope — the default catalog, exactly what the resolver falls back to */
    return DEFAULT_LOCALE;
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  // Identity, then authority — the house shape of the sensitive spend doors (agent-fit,
  // the recording DELETE, pipeline batch): requireOperator is the handler-level
  // re-verification of the session the proxy already checked (defence in depth, ADR
  // 0005), and it refuses an anonymous demo cookie outright. Then the capability:
  // rehearsing mints a billable voice session against the role's private hiring
  // judgement, so it asks what every other recruiter write on this surface asks, before
  // anything else — a refused seat learns nothing about which job or kit ids exist.
  const unauthenticated = await requireOperator();
  if (unauthenticated) return unauthenticated;
  const denied = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const ws = await currentWorkspace();
    // Ownership, the gate /publish and PUT use: a team rehearses exactly the roles it
    // may author for.
    const job = getJob(id, ws);
    if (!job || !canWriteJobLifecycle(id, ws)) return jsonRefusal("JOB_NOT_FOUND", 404);

    const body = await readJsonWithLimit<{ kitId?: unknown }>(request, MAX_REHEARSE_BODY_BYTES, {});
    if (body === BODY_TOO_LARGE) return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_REHEARSE_BODY_BYTES });
    const kitId = typeof body.kitId === "string" ? body.kitId.trim() : "";
    if (!kitId || kitId.length > MAX_KIT_ID_LEN) return jsonRefusal("INTERVIEW_KIT_NOT_FOUND", 404);

    // Workspace-bound read (another team's kit id resolves to nothing) plus the job
    // re-assertion (a version of a DIFFERENT role of this team is not this role's kit).
    // Draft or published alike.
    const stored = kitById(kitId, ws);
    if (!stored || stored.jobId !== id) return jsonRefusal("INTERVIEW_KIT_NOT_FOUND", 404);

    // KEYLESS: with no voice provider configured the call could never connect, so refuse
    // with the code /connect itself answers — BEFORE any session exists. `need` names the
    // missing env vars for the operator, beside the code rather than inside a sentence.
    const avail = voiceAvailability();
    const provider = pickDefaultProvider(undefined, avail);
    if (!avail[provider]) {
      return jsonRefusal("INTERVIEW_PROVIDER_UNCONFIGURED", 503, {
        provider,
        need: missingVoiceEnv(getVoiceAdapter(provider)),
      });
    }

    // Build the agenda NOW, for two reasons: its length is the session's booked length
    // (and so the reservation below), and a version that directs nothing must be refused
    // rather than minted into a call that would silently fall back to the generic lab
    // screen. Unreachable through the kit doors (the normalizer refuses a kit with no
    // competency), stated anyway because this door must not trust what it cannot see.
    const locale = await recruiterLocale();
    const planned = await buildKitOnlyInterviewKit(stored.id, ws, { locale });
    if (!planned) return jsonRefusal("INTERVIEW_KIT_INVALID", 400, { reason: "no_competencies", at: null });
    const durationMin = planned.agenda.durationMin;

    // BILLING — metered exactly like /simulate (interview-rehearsal.ts states the
    // decision): a rehearsal spends real provider minutes, /complete debits them on a
    // completed call, so reserve the WORST CASE that debit can charge
    // (maxBillableInterviewMin = 2× the booked length), against the CALLER's tenant —
    // the same tenant the session row is stamped with below, so gate and debit read one
    // meter. A self-hosted provider spends no allowance, so it is not gated.
    if (!isSelfHostedProvider(provider)) {
      const quota = meterGate("interview_minutes", { minUnits: maxBillableInterviewMin(durationMin), workspace: ws });
      if (quota) return jsonRefusal("BILLING_QUOTA_EXCEEDED", 402, { meter: quota.meter, plan: quota.plan });
    }

    // AFTER every refusal above (none of them spends, and none may be masked by the
    // budget) and BEFORE the session row, which is the billable artifact.
    if (!rateLimit(`interview-kit-rehearse:${clientIpFrom(request.headers)}`, REHEARSE_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    const session = createInterviewSession({
      workspaceId: ws,
      provider,
      // TEST mode, NO entry: /complete never scores, approves or seals a test session,
      // and the portal offers it neither a recording nor a status link.
      mode: "test",
      entryId: null,
      candidateLabel: null,
      jobId: id,
      jobTitle: job.title ?? null,
      // The FALLBACK brief, used only if /connect cannot rebuild the kit: the plain
      // quick-screen prompt, deliberately WITHOUT the director protocol — a brief that
      // describes tools the session was not given is a model calling tools at random.
      instructions: defaultInterviewerInstructions({ role: job.title, durationMin }),
      // The rail the portal paints before /connect answers: the agenda's own
      // candidate-safe titles, in order.
      runOfShow: toCandidateAgendaView(planned.agenda).blocks.map((b) => b.title),
      durationMin,
      language: locale,
      // The PIN: /connect rebuilds exactly this version, whatever is published later.
      kitId: stored.id,
    });

    // The recruiter's own copy of the link, same-origin and unpinned to a language (the
    // /create rule: ?lang= would rewrite their console's NEXT_LOCALE cookie).
    return NextResponse.json({ url: `/interview/${session.token}` });
  } catch (error) {
    // The catch sits on better-sqlite3 (the kit read, the billing-state read, the
    // session insert) whose messages carry the db path. It MINTS an interview, like
    // /create and /simulate, so it answers their code.
    return safeJsonError(error, "api:jobs/interview-kit/rehearse", "INTERVIEW_CREATE_FAILED");
  }
}
