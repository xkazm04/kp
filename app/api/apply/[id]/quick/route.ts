import { NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getServerLocale } from "@/i18n/server";
import { getJob } from "@/app/_lib/db/jobs";
import { applyKoSteps } from "@/app/_lib/apply";
import { APPLY_EMAIL_RE, failedKoStepIds, isHoneypotFilled } from "@/app/_lib/apply-intake";
import { getJobStatus, isJobOpenForApplications } from "@/app/_lib/job-ingest";
import { linkApplySession } from "@/app/_lib/apply-session-store";
import { intakeLead } from "@/app/_lib/lead-intake";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { getOrCreateStatusLink } from "@/app/_lib/application-status-store";
import { isRelayConfigured } from "@/app/_lib/comms-relay";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { afterResponse } from "@/app/_lib/after-response";
import { BODY_TOO_LARGE, readJsonWithLimit } from "@/app/_lib/request-body";

// Mint (or reuse) the entry's status-link token, best-effort — the application
// already succeeded, so a status-link failure must never turn it into an error
// (same contract as the conversational route's safeStatusLink).
function safeStatusToken(entryId: string): string | null {
  try {
    return getOrCreateStatusLink(entryId);
  } catch (err) {
    console.error(`[apply:quick] could not mint status link for entry ${entryId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}


// E2 (Erika gap) — the quick-apply LEAD form: the ≤30-second, ~3-field intake for
// ad/social traffic. Captures name + contact email + this job's own knockout
// questions; the shared lead-intake core (lead-intake.ts) files a passing lead at
// Accepted as an enrichable stub and fires the instant acknowledgement with the
// full-apply link. This route keeps what is surface-specific: input validation,
// the STRICT KO verdict (our own form asks every gate, so an ABSENT key is a
// fail — a scripted POST can't skip eligibility by omitting keys), and the
// localized candidate-facing response copy.
//
// Same trust-boundary discipline as the conversational POST: public,
// unauthenticated, side-effecting — body capped before buffering, fields bounded.

// The form carries three short fields and a few booleans — anything bigger is
// not a quick application. Fail closed well below the conversational cap.
const MAX_QUICK_BODY_BYTES = 16 * 1024;
const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 254; // RFC 5321 max address length
const MAX_ATTRIBUTION_LENGTH = 120; // E5 campaign/variant params from the ad link

// Abuse containment for this PUBLIC, side-effecting endpoint (each accept files a
// lead + fires an acknowledgement email). Per (job, client) fixed window; a touch
// higher than the conversational route since the lead form is lighter. Mirrors the
// inbound-channel route.
const QUICK_APPLY_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

// POST → evaluate the lead form. KO pass → an Accepted, intake-degraded lead
// entry + instant ack with the enrichment link; KO fail → a polite decline,
// audited as an entry-less ko_declined event (never a silent discard).
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    // Throttle BEFORE any DB read so a flood is rejected cheaply.
    if (!rateLimit(`apply-quick:${id}:${clientIpFrom(request.headers)}`, QUICK_APPLY_RATE_LIMIT)) {
      // Shared codeless 429 envelope (rate-limit-contract.test.ts pins it).
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const job = getJob(id);
    if (!job) return jsonRefusal("APPLY_ROLE_NOT_FOUND", 404);

    const t = await getTranslations("apply");
    // The language the candidate applied in, persisted on the entry so every
    // downstream comm (ack/rejection/interview/offer) renders in it.
    const applicantLocale = await getServerLocale();

    // A closed/draft role refuses the submission too (same W8-1 gate as the
    // conversational POST — the page gate alone is the documented anti-pattern).
    if (!isJobOpenForApplications(getJobStatus(id))) {
      // Coded, exactly like the conversational door's twin (see the note there):
      // the client renders errors.<CODE>, so a server-localized sentence with no
      // code was invisible to it.
      return jsonRefusal("APPLY_ROLE_CLOSED", 410);
    }

    // Enforced on the BYTES READ, not on content-length: that header is advisory, so
    // a caller who omits it (chunked) or lies about it walked past the old check and
    // streamed whatever it liked into the heap. The refusal keeps this surface's own
    // code — a candidate is told to shorten their answers, not "payload too large".
    const body = await readJsonWithLimit<{
      answers?: Record<string, unknown>;
      campaign?: unknown;
      variant?: unknown;
      company_url?: unknown;
      // The apply-funnel attempt this submission belongs to — measurement only,
      // grants nothing (see apply-session-store.ts).
      applySessionId?: unknown;
    }>(request, MAX_QUICK_BODY_BYTES, {});
    if (body === BODY_TOO_LARGE) return jsonRefusal("APPLY_PAYLOAD_TOO_LARGE", 413);
    // Anti-bot honeypot: a hidden `company_url` field no human fills. A bot that
    // auto-fills every input trips it — drop the submission silently (no lead, no
    // email) and return the normal decline copy, so the bot can't distinguish the
    // honeypot from an ordinary KO rejection and learn to evade it.
    if (isHoneypotFilled(body)) {
      return NextResponse.json({ result: "declined", message: t("declinedMessage") });
    }
    const answers = body.answers ?? {};
    const name = String(answers.name ?? "").trim();
    const email = String(answers.email ?? "").trim();
    // E5 — ad-link attribution forwarded by the form; bounded, never trusted further.
    const campaign = String(body.campaign ?? "").trim().slice(0, MAX_ATTRIBUTION_LENGTH);
    const variant = String(body.variant ?? "").trim().slice(0, MAX_ATTRIBUTION_LENGTH);

    // Unlike the conversational flow (where a contactless application still
    // files), the lead form's entire point is a REACHABLE candidate — without an
    // address the enrichment loop can never close, so both fields are required.
    if (!name) {
      return jsonRefusal("APPLY_NAME_REQUIRED", 400, { field: "name" });
    }
    if (name.length > MAX_NAME_LENGTH) {
      return jsonRefusal("APPLY_NAME_TOO_LONG", 400, { field: "name", max: MAX_NAME_LENGTH });
    }
    if (email.length > MAX_EMAIL_LENGTH) {
      return jsonRefusal("APPLY_EMAIL_TOO_LONG", 400, { field: "email", max: MAX_EMAIL_LENGTH });
    }
    if (!email || !APPLY_EMAIL_RE.test(email)) {
      return jsonRefusal("APPLY_EMAIL_INVALID", 400, { field: "email" });
    }

    // ABSOLUTE link to the full conversational apply (the candidate opens it from
    // an email, outside the app), pinned to the language they applied in.
    // lead-intake appends the entry's opaque lead token (&lead=…) before the ack
    // goes out, so the link opens prefilled and merges back onto the lead's entry.
    const base = publicBaseUrl(new URL(request.url).origin);
    const enrichLink = `${base}/apply/${job.id}?lang=${applicantLocale}`;

    const expectedKoIds = applyKoSteps(job, t).map((s) => s.id);
    const outcome = await intakeLead({
      job,
      name,
      email,
      locale: applicantLocale,
      sourceChannel: "quick-apply",
      sourceCampaign: campaign || null,
      sourceVariant: variant || null,
      channelLabel: "quick apply",
      // E4 speed-to-lead is about the LEAD landing fast, not about the applicant
      // watching an SMTP round-trip: the ack dispatch runs after this response.
      defer: (task) => afterResponse("quick-apply-ack", task),
      // STRICT verdict: every expected KO answer must be present AND true.
      failedKoIds: failedKoStepIds(expectedKoIds, answers),
      // …so an ACCEPT means every gate was explicitly answered true: record them
      // all, and the enrichment chat skips exactly these (a gate the job gains
      // later isn't in the record and gets asked).
      passedKoIds: expectedKoIds,
      enrichLink,
      // capst-l1-002 — the ack email carries the same durable status link the
      // conversational path has always sent (getOrCreateStatusLink is idempotent
      // per entry, so email and success screen share ONE token).
      // …pinned to the applied-in language, exactly like enrichLink above: the
      // ack email is read outside the app, with no NEXT_LOCALE cookie, so a bare
      // link dropped a Czech lead onto an English status page (proxy.ts turns
      // ?lang= back into the cookie).
      statusLinkFor: (entryId) => {
        const token = safeStatusToken(entryId);
        return token ? `${base}/status/${token}?lang=${applicantLocale}` : null;
      },
    });

    if (outcome.result === "declined") {
      return NextResponse.json({ result: "declined", message: t("declinedMessage") });
    }
    // The lead was filed (new or duplicate) — link the attempt that produced it.
    linkApplySession(typeof body.applySessionId === "string" ? body.applySessionId : null, outcome.entryId);
    // CAPABILITY GATE — a DUPLICATE response carries no tokens.
    //
    // A duplicate here is detected from the submitted email alone
    // (findApplicationByApplicant inside intakeLead), and an email address is not
    // a secret: anyone could POST this 3-field form with someone else's address
    // and be handed that person's `leadToken` (which opens
    // /apply/<job>?lead=<token> with their name and email prefilled, and
    // authorizes the profile follow-up POST) and their `statusToken` (which opens
    // /status/<token> — live stage plus the EU AI-Act decision history, an
    // auto-reject's score-vs-threshold included). The status-link store's premise
    // is that its token is the only public handle, "so a candidate can check their
    // own status without anyone being able to enumerate others'".
    //
    // The real returning candidate loses nothing they own: their first submission's
    // done screen carried both links and the acknowledgement email carries them
    // durably, delivered to the address we can actually authenticate. `leadToken`
    // in particular was already dead on this branch — QuickApplyForm renders the
    // enrichment CTA only when `fresh` (accepted AND not duplicate).
    if (outcome.duplicate) {
      return NextResponse.json({
        result: "accepted",
        duplicate: true,
        message: t("alreadyMessage"),
      });
    }
    // `leadToken` lets the success screen's "complete your profile" CTA carry
    // the same identity as the emailed link (see QuickApplyForm); `statusToken`
    // gives the done screen the status link the flow used to omit. Minted only on
    // the fresh path — this request is the one that filed the entry.
    const statusToken = safeStatusToken(outcome.entryId);
    // REC-10 honesty: "We've emailed you a confirmation" is only claimed when a
    // delivery relay actually exists; offline, the ack is a local outbox row, so
    // the candidate is pointed at the status link instead of a phantom email.
    return NextResponse.json({
      result: "accepted",
      message: t(isRelayConfigured() ? "quick.acceptedMessage" : "quick.acceptedMessageNoRelay"),
      leadToken: outcome.leadToken,
      statusToken,
    });
  } catch (error) {
    // Same public-surface hygiene as the conversational POST: the raw message
    // behind this catch is store/subprocess internals, never candidate copy.
    return safeJsonError(error, "api:apply:quick", "APPLY_FAILED");
  }
}
