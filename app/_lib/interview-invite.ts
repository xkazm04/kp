// The ONE server-side door that mints a candidate-mode voice screen and puts the
// tokenized link in front of the candidate.
//
// This used to live entirely inside `app/api/interview/create/route.ts`, which
// made the recruiter's "Create link" button the only way to reach it. The stage
// hook (`stage-hooks.ts`) needs exactly the same sequence — live-call guard,
// grounded build, authoritative billing reservation, revoke-then-create, truthful
// invite dispatch — and re-implementing any one of those is how two paths that
// mint the same credential end up disagreeing about reissue semantics or about
// what "sent" means. So the sequence moved here and the route became its HTTP
// face: it keeps the transport concerns (body validation, the per-IP throttle,
// the cheap pre-gate before parsing, submission→entry resolution) and calls this
// for the work.
//
// Everything here is server-only: it touches the DB, the billing meter, the LLM
// grounding build and the comms outbox.

import { meterGate, maxBillableInterviewMin } from "@/app/_lib/billing/enforce";
import {
  createInterviewSession,
  isInterviewSessionLive,
  liveInterviewByEntry,
  revokeOpenInterviewSessions,
  type InterviewSession,
} from "@/app/_lib/db/interviews";
import { getPipelineEntry } from "@/app/_lib/db/pipeline";
import { entryContactability } from "@/app/_lib/comms-contactability";
import { latestPublishedKit } from "@/app/_lib/interview-kit";
import type { StoredInterviewKit } from "@/app/_lib/interview-kit-types";
import { buildGroundedInterview } from "@/app/_lib/interview-run";
import { dispatchInterviewInvite } from "@/app/_lib/comms-dispatch";
import { deliveryClaim, type DeliveryClaim } from "@/app/_lib/comms-truth";
import { isRelayConfigured } from "@/app/_lib/comms-relay";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { coerceLanguage, pickDefaultProvider, voiceAvailability, type VoiceProviderId } from "@/app/_lib/voice";

/** Why an invite did not reach the candidate, when the session itself was created.
 *  Both resolve through `useErrorMessage()` like every other code on this wire, and
 *  both carry the same remedy: the link is in the response, hand it over yourself. */
export type InviteDeliveryError = "INVITE_PROVIDER_UNCONFIGURED" | "INVITE_DISPATCH_FAILED" | null;

/** The billing refusal, carried as DATA rather than as a thrown error: the route
 *  turns it into a 402 with the meter/plan the card renders, and the stage hook
 *  turns it into a `interview_invite_failed` event. Neither invents the shape. */
export type MeterRefusal = NonNullable<ReturnType<typeof meterGate>>;

export type VoiceScreenMintResult =
  | { ok: false; refusal: "BILLING_QUOTA_EXCEEDED"; quota: MeterRefusal }
  | { ok: false; refusal: "INTERVIEW_CALL_IN_PROGRESS" }
  /** The SEND GATE refuses this candidate (consent lapsed but not yet swept, or
   *  erased): nothing was built, reserved, revoked, minted or mailed. */
  | { ok: false; refusal: "COMMS_SUPPRESSED" }
  | {
      ok: true;
      session: InterviewSession;
      provider: VoiceProviderId;
      configured: boolean;
      delivered: boolean;
      /** The TRUTHFUL claim (REC-10): the outbox row's real status, never a green lie. */
      delivery: DeliveryClaim;
      deliveryError: InviteDeliveryError;
      /** How many prior open links this reissue invalidated. */
      revoked: number;
      /** The absolute, locale-pinned link that was mailed (null when nothing was sent). */
      invitedLink: string | null;
    };

export type VoiceScreenMintInput = {
  entryId: string;
  workspaceId: string;
  /** Request origin — only used to build the candidate link, and only as the LAST
   *  of `publicBaseUrl`'s three sources. A caller with no request (the stage hook,
   *  a background sweep) passes null and gets the configured/canonical origin. */
  origin?: string | null;
  /** Raw provider hint from a caller; `pickDefaultProvider` validates it. */
  provider?: unknown;
  /** Raw language hint; `coerceLanguage` validates it. */
  language?: unknown;
  /** Explicit override of the live-call guard (the recruiter's "reissue anyway"). */
  force?: boolean;
};

/**
 * Mint a candidate-mode voice screen for a pipeline entry and invite the candidate.
 *
 * Order is load-bearing — the route's original order, with the kit pin moved ahead of
 * the build because the kit now sets the booked length:
 *   1. live-call guard — a reissue must not torpedo a call in progress;
 *   1b. the send gate (`entryContactability`) — a candidate we may no longer write to
 *      gets no model-backed build, no reservation and no link;
 *   2. the job-kit pin, then the grounded build, so the booked duration is known
 *      (a pinned kit sets it) and so a build failure can never kill the candidate's
 *      existing live link;
 *   3. AUTHORITATIVE billing reservation against the worst case /complete can
 *      debit (bookedMin*2), before anything is revoked;
 *   4. revoke-then-create, so exactly one link is live per entry;
 *   5. best-effort invite dispatch, whose real outbox status becomes `delivery`.
 *
 * Throws only what `buildGroundedInterview` throws (notably
 * `Error("pipeline entry not found")`); every business refusal is returned.
 */
export async function mintAndInviteVoiceScreen(input: VoiceScreenMintInput): Promise<VoiceScreenMintResult> {
  const { entryId, workspaceId, origin = null } = input;
  const avail = voiceAvailability();
  const provider: VoiceProviderId = pickDefaultProvider(input.provider, avail);

  // A reissue must not torpedo a LIVE call (voice-interview-runtime #2): the
  // revoke-first semantics below kill in_progress sessions too, so one click on a
  // mid-call entry revoked the candidate's session and emailed them a second
  // invite while they were still talking. Stale zombies (a connect that never
  // completed, older than the recency window) fall through and may be reissued.
  if (input.force !== true) {
    const live = liveInterviewByEntry(entryId, workspaceId);
    if (live && isInterviewSessionLive(live)) return { ok: false, refusal: "INTERVIEW_CALL_IN_PROGRESS" };
  }

  // PIN THE KIT AT MINT (spark interview-kit-template). The link carries the job kit
  // VERSION that was published when it was created, so an edit landing mid-round
  // cannot change what a candidate already holding a link is asked and the round's
  // ratings stay comparable. Resolved here rather than at connect for exactly that
  // reason: connect runs when the candidate clicks, which may be days later. Resolved
  // BEFORE the grounded build because the pinned kit sets the booked length (the build
  // books it through interview-kit-booking.ts kitBookedMin, the one rule every surface
  // reads, and states it in the saved fallback brief).
  // Best-effort — a job with no kit, or a kit that cannot be read, mints the link the
  // way it always did rather than failing the invite.
  const entry = getPipelineEntry(entryId, workspaceId);

  // ASK THE SEND GATE FIRST (challenge-r09 follow-up to comms-locale-optout/A). Every
  // other candidate-link door asks `entryContactability` before it mints; this one used
  // to meet the gate only inside the best-effort dispatch below, AFTER a model-backed
  // build and a live session — so "Start interview" minted a working /interview/<token>
  // for an opted-out / consent-lapsed / erased candidate while "Send link" on the same
  // card was refused 409. Only a CODED refusal stops the mint: an unaddressable person
  // (the recruiter hands the link over by hand) and an agent slate keep their existing
  // paths. No entry → fall through, so the build's not-found stays the one answer.
  // Verdict-then-mint holds no lock by design; sendComm re-checks at the send.
  if (entry) {
    const contactable = entryContactability(entry, "interview_invite");
    if (!contactable.ok && contactable.code) return { ok: false, refusal: contactable.code };
  }

  const jobId = entry?.jobId ?? null;
  let pinned: StoredInterviewKit | null = null;
  if (jobId) {
    try {
      pinned = latestPublishedKit(jobId, workspaceId);
    } catch (kitErr) {
      // Not silent: the round loses its shared spine and the recruiter would want to
      // know, but a candidate must still get their link.
      console.error(`[interview:mint] interview kit unreadable for job ${jobId}:`, kitErr);
    }
  }
  const kitId = pinned?.id ?? null;

  const grounded = await buildGroundedInterview(entryId, workspaceId, { pinnedKit: pinned?.kit ?? null });

  // AUTHORITATIVE billing reservation: refuse unless the meter can cover the WORST
  // CASE /complete can debit for THIS session — maxBillableInterviewMin(bookedMin) =
  // bookedMin*2, the exact ceiling the debit clamps to.
  const reserve = meterGate("interview_minutes", { minUnits: maxBillableInterviewMin(grounded.durationMin), workspace: workspaceId });
  if (reserve) return { ok: false, refusal: "BILLING_QUOTA_EXCEEDED", quota: reserve };

  // W6-4 (VOX1) — reissue semantics: a fresh link kills the prior ones, so exactly
  // one link is live per entry.
  const revoked = revokeOpenInterviewSessions(entryId, workspaceId);

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
    language: coerceLanguage(input.language),
    // The entry (resolved under THIS caller's tenant) is authoritative and wins
    // inside the store; stating the caller's team too keeps the gate above and the
    // row below reading the same tenant on any path that loses the entry.
    workspaceId,
    kitId,
  });

  // Deliver the link TO the candidate (the screen is candidate-mode — they take the
  // call). Gated on the provider being configured: an unconfigured key means the
  // call can't connect, so don't invite someone to a dead link. Best-effort — a
  // comms failure must not fail session creation, since the link is returned and
  // can be handed over by hand.
  let delivered = false;
  let delivery: DeliveryClaim = "failed";
  let deliveryError: InviteDeliveryError = null;
  let invitedLink: string | null = null;
  if (!avail[provider]) {
    deliveryError = "INVITE_PROVIDER_UNCONFIGURED";
  } else {
    try {
      // SIM3 — invite in the applicant's language, and pin the LINK to it too
      // (`?lang=`): an absolute link opened from an email carries no NEXT_LOCALE
      // cookie, and the portal seeds the spoken-agent hint (and therefore the
      // provider's ASR language) from its UI locale. Only the EMAILED link is
      // pinned; the link handed back to a recruiter must not rewrite their own
      // console language.
      const inviteLocale = getPipelineEntry(entryId, workspaceId)?.locale ?? null;
      const langQuery = inviteLocale ? `?lang=${encodeURIComponent(inviteLocale)}` : "";
      invitedLink = `${publicBaseUrl(origin)}/interview/${session.token}${langQuery}`;
      const status = await dispatchInterviewInvite(
        { id: entryId, candidateLabel: session.candidateLabel, jobTitle: session.jobTitle, locale: inviteLocale },
        invitedLink,
        { durationMin: grounded.durationMin, workspaceId }
      );
      delivery = deliveryClaim(isRelayConfigured(), status);
      delivered = delivery !== "failed";
      if (delivery === "failed") deliveryError = "INVITE_DISPATCH_FAILED";
    } catch (commErr) {
      // Best-effort by design, but an operator WOULD act on this, so it is both
      // logged with the session id and carried back as a class.
      deliveryError = "INVITE_DISPATCH_FAILED";
      console.error(
        `[interview:mint] session ${session.token} created but invite delivery failed: ${commErr instanceof Error ? commErr.message : commErr}`
      );
    }
  }

  return { ok: true, session, provider, configured: avail[provider], delivered, delivery, deliveryError, revoked, invitedLink };
}
