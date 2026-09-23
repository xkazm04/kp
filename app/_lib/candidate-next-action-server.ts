import type { PipelineEntry } from "./db/core";
import { latestInterviewByEntry } from "./db/interviews";
import { listScheduleInvitesForEntry, type ScheduleInvite } from "./schedule-store";
import { getOpenOfferForEntry, type OfferRow } from "./offers-store";
import { clearFailures, isThrottled, recordFailedAttempt } from "./auth/login-throttle";
import { dispatchInterviewInvite, dispatchOfferReminder, dispatchScheduleInvite } from "./comms-dispatch";
import { pinLinkLocale } from "./candidate-link-locale";
import { resolveCommsLocale } from "./comms-locale";
import { publicBaseUrl } from "./public-base-url";
import {
  ACTION_RESEND_THROTTLE,
  candidateNextAction,
  decideActionResend,
  pickLiveInvite,
  type ActionResendSkip,
  type CandidateNextAction,
} from "./candidate-next-action";

// The server half of the status page's "Waiting on you" card (challenge-r06
// application-status-page/B): read the three stores that hold a candidate capability,
// project what is pending (candidate-next-action.ts), and re-send it to the inbox.
//
// THE RESEND DOCTRINE is link recovery's (apply-link-recovery.ts, r01):
//   - the letter goes to `entry.contact` and nowhere else — never to anything the
//     caller typed (the door takes no body at all);
//   - one resend per ENTRY per 24h, persisted across workers (login-throttle), so a
//     forwarded status link can cause at most one letter a day, to the real candidate,
//     carrying only that candidate's own link;
//   - never to an anonymized (erased) record: it is excluded from every path that
//     treats it as a person, outreach included;
//   - the SAME existing capability is re-sent through its existing letter (schedule
//     invite, interview invite, offer reminder): no token is minted, rotated or put on
//     the forwardable page.
//
// THE VERDICT is the dispatcher's (comms-dispatch-relay/A): sent | queued | failed |
// refused, off the recorded outbox row. A failed or refused send releases the cooldown
// so the candidate can try again, and the route says it did not go — never a green lie.

type Pending = {
  action: CandidateNextAction;
  offer: OfferRow | null;
  invite: ScheduleInvite | null;
  interview: ReturnType<typeof latestInterviewByEntry>;
};

function readPending(entry: PipelineEntry, nowMs: number): Pending | null {
  // Short-circuit before any store read: a closed or erased application has nothing
  // waiting, whatever rows still exist.
  if (entry.status !== "active" || entry.anonymizedAt) return null;
  const offer = getOpenOfferForEntry(entry.id);
  const invites = listScheduleInvitesForEntry(entry.id, entry.workspaceId);
  const interview = latestInterviewByEntry(entry.id, entry.workspaceId);
  const action = candidateNextAction({
    entryStatus: entry.status,
    anonymized: Boolean(entry.anonymizedAt),
    invites,
    openOffer: offer,
    interview,
    nowMs,
  });
  if (!action) return null;
  return { action, offer, invite: pickLiveInvite(invites, nowMs), interview };
}

/** The public projection for GET /api/status/[token]: three keys or null. */
export function nextActionForEntry(entry: PipelineEntry, nowMs: number = Date.now()): CandidateNextAction | null {
  return readPending(entry, nowMs)?.action ?? null;
}

/** The persisted cooldown bucket. Keyed on the ENTRY, never on the caller. */
export function actionResendKey(entryId: string): string {
  return `status-resend:${entryId}`;
}

export type ActionResendClaim = "sent" | "queued" | "failed" | "refused";
export type ActionResendResult =
  | { outcome: "nothing_pending" }
  | { outcome: "skipped"; reason: ActionResendSkip }
  | { outcome: "dispatched"; claim: ActionResendClaim };

/** Re-send the pending capability to the address on file. Awaited, so the route can
 *  answer with the dispatcher's real verdict. `origin` is the request origin, used only
 *  as publicBaseUrl's fallback (the link is opened from an email, outside the app). */
export async function resendNextAction(
  entry: PipelineEntry,
  opts: { origin?: string | null; relayConfigured: boolean; nowMs?: number }
): Promise<ActionResendResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const pending = readPending(entry, nowMs);
  if (!pending) return { outcome: "nothing_pending" };

  const key = actionResendKey(entry.id);
  const contact = entry.contact;
  const decision = decideActionResend({
    contact,
    anonymized: Boolean(entry.anonymizedAt),
    throttled: Boolean((contact ?? "").trim()) && isThrottled(key, ACTION_RESEND_THROTTLE, nowMs),
    relayConfigured: opts.relayConfigured,
  });
  if (!decision.send) return { outcome: "skipped", reason: decision.reason };
  // Claim the slot atomically (one UPSERT): of two racing requests only the one that
  // counts 1 sends — the read above is a cheap pre-check, not the lock.
  if (recordFailedAttempt(key, ACTION_RESEND_THROTTLE, nowMs) > 1) return { outcome: "skipped", reason: "cooldown" };

  const base = publicBaseUrl(opts.origin ?? null);
  // Pinned to the language the LETTER renders in (the entry's own, resolved against its
  // team), not the language of whoever clicked.
  const lang = resolveCommsLocale(entry.locale, entry.workspaceId);
  let claim: ActionResendClaim;
  try {
    const { action, offer, invite, interview } = pending;
    if (action.kind === "answer_offer" && offer) {
      claim = (await dispatchOfferReminder(entry, `${base}/offer/${offer.token}`, offer.expiresAt)).claim;
    } else if (action.kind === "book_interview" && invite) {
      const link = pinLinkLocale(`${base}/schedule/${invite.token}`, lang);
      claim = toClaim(await dispatchScheduleInvite(entry, link, { durationMin: invite.durationMin }));
    } else if (action.kind === "take_interview" && interview) {
      const link = pinLinkLocale(`${base}/interview/${interview.token}`, lang);
      claim = toClaim(
        await dispatchInterviewInvite(
          { id: entry.id, candidateLabel: entry.candidateLabel, candidateId: entry.candidateId, jobTitle: entry.jobTitle, locale: entry.locale },
          link,
          { durationMin: interview.durationMin, workspaceId: entry.workspaceId }
        )
      );
    } else {
      claim = "failed";
    }
  } catch (err) {
    // The letter did not go: free the slot so the candidate's retry is not refused as a
    // cooldown for a send that never happened.
    clearFailures(key);
    throw err;
  }
  if (claim === "failed" || claim === "refused") clearFailures(key);
  return { outcome: "dispatched", claim };
}

function toClaim(status: string): ActionResendClaim {
  return status === "sent" ? "sent" : status === "queued" ? "queued" : "failed";
}
