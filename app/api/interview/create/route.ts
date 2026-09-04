import { NextRequest, NextResponse } from "next/server";
import { meterGate, maxBillableInterviewMin } from "@/app/_lib/billing/enforce";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { createInterviewSession, isInterviewSessionLive, liveInterviewByEntry, revokeOpenInterviewSessions } from "@/app/_lib/db/interviews";
import { getPipelineEntry } from "@/app/_lib/db/pipeline";
import { resolveEntryForSubmission } from "@/app/_lib/devcase-interview-entry";
import { buildGroundedInterview } from "@/app/_lib/interview-run";
import { dispatchInterviewInvite } from "@/app/_lib/comms-dispatch";
import { deliveryClaim, type DeliveryClaim } from "@/app/_lib/comms-truth";
import { isRelayConfigured } from "@/app/_lib/comms-relay";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { readEntityId } from "../entry-id";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { coerceLanguage, pickDefaultProvider, voiceAvailability, type VoiceProviderId } from "@/app/_lib/voice";
import { GROUNDED_DEFAULT_MIN } from "@/app/_lib/interview-duration.mjs";

// Per-IP spend door. One accepted call runs a model-backed run-of-show build AND
// emails the candidate, and the route is operator-gated only in the sense that
// open mode (KP_OPERATOR_PASSWORD unset) makes that gate a documented no-op for the
// ENTIRE API - so the limiter is the real bound, exactly as it is on the JD
// library's four spend doors. 20/10min: a Create link is followed by a human
// reading the drawer, so twenty in ten minutes is far above honest pace, while an
// automated loop over a board would otherwise spend LLM credit and mail a stranger
// once per request. The billing meter is a separate, per-workspace decision and
// deliberately not what this is.
const CREATE_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };


/** Why an invite did not reach the candidate, when the session itself was created.
 *  Both resolve through `useErrorMessage()` like every other code on this wire, and
 *  both carry the same remedy: the link is in the response, hand it over yourself. */
type InviteDeliveryError = "INVITE_PROVIDER_UNCONFIGURED" | "INVITE_DISPATCH_FAILED" | null;

// POST → recruiter creates a candidate-mode voice screen for a pipeline entry.
// Builds grounded interviewer questions (Task 4) and returns a tokenized link
// to hand to the candidate. After the call, /complete runs the scorecard.
export async function POST(request: NextRequest) {
  try {
    // Billing hard gate — CHEAP PRE-CHECK: voice minutes are the one meter with real
    // per-unit cost. Reject an obviously-empty meter before doing the (possibly
    // LLM-backed) run-of-show build below. This uses the 20-min default because the
    // session's real booked length isn't known yet; the AUTHORITATIVE reservation —
    // gating on the WORST CASE /complete can debit (bookedMin*2) — runs once `grounded`
    // is built, before we revoke any existing link. (Minutes debit at /complete; top-up
    // packs reopen this.)
    // Org attribution (org-plan Phase 3): both gates read the caller's tenant.
    const workspace = await currentWorkspace();
    const quota = meterGate("interview_minutes", { minUnits: GROUNDED_DEFAULT_MIN, workspace });
    if (quota) return jsonRefusal("BILLING_QUOTA_EXCEEDED", 402, { meter: quota.meter, plan: quota.plan });
    // Validate at the trust boundary instead of casting request.json() to a
    // typed shape (idea-c7df6b55): entryId must be a plausibly-sized string and
    // language must look like a language tag — anything else is rejected or
    // dropped rather than passed into the DB layer.
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    // ONE THREAD (gap 4) — a screen can be asked for by the entry it hangs off OR by
    // the SUBMISSION the reviewer is looking at. The eval surface holds a submission
    // id and never held an entry id, which is why the voice screen was reachable only
    // from the board. `entryId` still wins when both are sent: it is the more specific
    // request, and resolving a submission could legitimately answer a DIFFERENT entry
    // (the candidate applied to the opening directly and the promote backfilled that
    // row) — silently overriding an explicit entry would be the surprising half.
    let entryId = readEntityId(body.entryId) ?? "";
    let promotedForScreen = false;
    const submissionId = readEntityId(body.submissionId) ?? "";
    // Named NOTHING usable: refuse before the throttle below, so a malformed call
    // can never spend another caller's budget (the shape the JD spend doors follow).
    if (!entryId && !submissionId) {
      return jsonRefusal("INTERVIEW_ENTRY_REQUIRED", 400);
    }

    // Everything past this point either PROMOTES a submission onto the board, runs
    // the LLM-backed grounding, or emails the candidate. Throttle here, per IP.
    if (!rateLimit(`interview-create:${clientIpFrom(request.headers)}`, CREATE_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    if (!entryId && submissionId) {
      // Resolves, or promotes through the SHARED promote door and then resolves — this
      // route never mints an identity of its own (devcase-interview-entry.ts).
      const resolved = resolveEntryForSubmission(submissionId, workspace);
      if (!resolved.ok) {
        // Unknown id and another team's id answer alike, on purpose: a distinct
        // refusal would confirm which submission ids exist on other tenants.
        return resolved.reason === "not_evaluated"
          ? jsonRefusal("INTERVIEW_SUBMISSION_NOT_EVALUATED", 400)
          : jsonRefusal("INTERVIEW_SUBMISSION_NOT_FOUND", 404);
      }
      entryId = resolved.entryId;
      promotedForScreen = resolved.promoted;
    }
    if (!entryId) {
      return jsonRefusal("INTERVIEW_ENTRY_REQUIRED", 400);
    }

    const avail = voiceAvailability();
    const provider: VoiceProviderId = pickDefaultProvider(body.provider, avail);

    // A reissue must not torpedo a LIVE call (voice-interview-runtime #2): the
    // revoke-first semantics below kill in_progress sessions too, so one click
    // on a mid-call entry revoked the candidate's session and emailed them a
    // second invite while they were still talking. Hold the line like
    // /connect's guards: refuse while the entry has a recently-touched
    // in_progress session. Stale zombies (a connect that never completed,
    // older than the recency window) fall through and may be reissued;
    // `force: true` is the explicit recruiter override.
    if (body.force !== true) {
      const live = liveInterviewByEntry(entryId, workspace);
      if (live && isInterviewSessionLive(live)) {
        return jsonRefusal("INTERVIEW_CALL_IN_PROGRESS", 409);
      }
    }

    // Build the run-of-show FIRST so its booked duration is known — and BEFORE the
    // revoke below, so a quota refusal or a build failure can never kill the
    // candidate's existing live link (revoke now happens only once we're committed).
    const grounded = await buildGroundedInterview(entryId, workspace);

    // AUTHORITATIVE billing reservation: refuse unless the meter can cover the WORST
    // CASE /complete can debit for THIS session — maxBillableInterviewMin(bookedMin) =
    // bookedMin*2, the exact ceiling the debit clamps to. The cheap pre-gate above only
    // reserved the 20-min default, so a session booked for 30 min (up to 60 billed) could
    // pass with 20 minutes left and drive the priciest meter negative. Reserving the true
    // ceiling closes that under-reservation.
    const reserve = meterGate("interview_minutes", { minUnits: maxBillableInterviewMin(grounded.durationMin), workspace });
    if (reserve) return jsonRefusal("BILLING_QUOTA_EXCEEDED", 402, { meter: reserve.meter, plan: reserve.plan });

    // W6-4 (VOX1) — reissue semantics: a fresh link kills the prior ones.
    // Re-clicking "Create link" used to mint a SECOND live session (and email a
    // second invite) while the first stayed valid forever — and the
    // latest-by-created_at read meant an old link completed after a reissue
    // wasn't even the surfaced session. Revoking first makes exactly one link
    // live per entry.
    const revoked = revokeOpenInterviewSessions(entryId, workspace);

    const session = createInterviewSession({
      provider,
      mode: "candidate",
      entryId,
      candidateLabel: grounded.candidateLabel,
      jobId: grounded.jobId,
      jobTitle: grounded.jobTitle,
      instructions: grounded.instructions,
      runOfShow: grounded.runOfShow,
      durationMin: grounded.durationMin,
      language: coerceLanguage(body.language),
      // The entry (resolved above under THIS caller's tenant) is authoritative and
      // wins inside the store; stating the caller's team too keeps the gate above
      // and the row below reading the same tenant on any path that loses the entry.
      workspaceId: workspace,
    });

    // Deliver the link TO the candidate (the screen is candidate-mode — they take
    // the call). Gated on the provider being configured: an unconfigured key means
    // the call can't connect, so don't invite someone to a dead link. Goes through
    // the durable Outbox channel (real relay only when configured), and is
    // best-effort — a comms failure must not fail session creation, since the
    // recruiter can still copy the link returned below as a manual fallback.
    // `delivery` is the TRUTHFUL claim (REC-10): the outbox row's real status —
    // sent only on a relayed 2xx, queued when the local outbox is the terminal
    // target, failed on a dead-letter/throw — so the drawer note can't say
    // "invite sent to the candidate" about a message nothing will deliver.
    // …and when it does NOT arrive, WHY, as a code the drawer can render in the
    // reader's language. `delivery` already told the truth about the outbox row, but
    // "failed" alone left the recruiter guessing between "this server has no voice
    // keys, so no invite was even attempted" and "the relay threw" - two different
    // next actions, and only the second is worth a retry. The link itself is always
    // returned, so the manual fallback (copy it to the candidate) is the remedy for
    // both; the class is what says so out loud instead of only in a server log.
    let delivered = false;
    let delivery: DeliveryClaim = "failed";
    let deliveryError: InviteDeliveryError = null;
    if (!avail[provider]) {
      deliveryError = "INVITE_PROVIDER_UNCONFIGURED";
    }
    if (avail[provider]) {
      try {
        // SIM3 — invite in the applicant's language; the session carries no
        // locale, so read it off the entry (one lookup, only on a delivered invite).
        // Scoped: an unscoped read resolved against the default team, so on any
        // other workspace this returned null and every invite fell back to the
        // workspace default language instead of the candidate's own.
        const inviteLocale = getPipelineEntry(entryId, workspace)?.locale ?? null;
        // …and the LINK carries that locale too (`?lang=`, handled by proxy.ts's
        // locale override) — the convention the apply ack's /status link, the
        // erasure /data link and the enrichment link all already follow, and the
        // one candidate link that had been missing it. This is an ABSOLUTE link
        // opened from an email, where no NEXT_LOCALE cookie exists yet, so without
        // it a Czech applicant received a Czech invite and landed on an ENGLISH
        // interview portal. That was not merely cosmetic: the portal hides the
        // language picker for candidates and seeds the spoken-agent hint from that
        // UI locale (VoiceInterview.tsx: `locale === "cs" ? "cs" : "en"`), the hint
        // rides POST /connect into the provider session config, and
        // buildOpenAiSessionPayload PINS input-audio transcription to it — while
        // the voice harness showed transport config BEATS the brief's prompt-level
        // language lock (voice/openai.ts). So a Czech-speaking candidate whose
        // brief had been told to open in Czech (withOpeningLanguage, same
        // entry.locale) was transcribed against an English ASR, and that transcript
        // is what the scorecard and the Interview→Offer gate then rest on.
        // Only the EMAILED link is pinned: the `url` in the response is opened by
        // the RECRUITER (Schedule tab's window.open, drawer copy), and ?lang= there
        // would rewrite their own NEXT_LOCALE cookie and flip the console's language.
        const langQuery = inviteLocale ? `?lang=${encodeURIComponent(inviteLocale)}` : "";
        const link = `${publicBaseUrl(new URL(request.url).origin)}/interview/${session.token}${langQuery}`;
        const status = await dispatchInterviewInvite(
          { id: entryId, candidateLabel: session.candidateLabel, jobTitle: session.jobTitle, locale: inviteLocale },
          link,
          { durationMin: grounded.durationMin, workspaceId: workspace }
        );
        delivery = deliveryClaim(isRelayConfigured(), status);
        delivered = delivery !== "failed";
        if (delivery === "failed") deliveryError = "INVITE_DISPATCH_FAILED";
      } catch (commErr) {
        // Best-effort by design (the recruiter can copy the link), but an operator
        // WOULD act on this, so it is both logged with the session id and carried
        // back as a class rather than dropped into the log alone.
        deliveryError = "INVITE_DISPATCH_FAILED";
        console.error(
          `[interview:create] session ${session.token} created but invite delivery failed: ${commErr instanceof Error ? commErr.message : commErr}`
        );
      }
    }

    return NextResponse.json({
      token: session.token,
      url: `/interview/${session.token}`,
      provider,
      configured: avail[provider],
      delivered,
      delivery,
      // null on a clean send; otherwise the reason, as an `errors.<CODE>` key.
      deliveryError,
      // W6-4 — how many prior open links this reissue invalidated (UI hint).
      revoked,
      candidateLabel: session.candidateLabel,
      jobTitle: session.jobTitle,
      // ONE THREAD — the entry this screen hangs off, echoed so a caller who asked by
      // submissionId learns which board row it landed on, and `promoted` so it can say
      // that starting the screen also put the candidate there. Both are stated rather
      // than left for the recruiter to discover from the board.
      entryId,
      promoted: promotedForScreen,
    });
  } catch (error) {
    // buildGroundedInterview's not-found is a client-safe business rule, not an
    // internal leak — keep it specific. Everything else (SQLite, automation,
    // prep-generation errors) goes through the generic safe responder so raw
    // err.message never crosses the wire (idea-ab117371).
    if (error instanceof Error && error.message === "pipeline entry not found") {
      // Unknown entry and ANOTHER TEAM'S entry land here alike (buildGroundedInterview
      // resolves under the caller's workspace), which is the refusal the tenancy pass
      // wanted: one answer, no oracle.
      return jsonRefusal("PIPELINE_ENTRY_NOT_FOUND", 404);
    }
    return safeJsonError(error, "api:interview:create", "INTERVIEW_CREATE_FAILED");
  }
}
