import { INVITE_LINK_TTL_DAYS, isScheduleInviteExpired } from "./schedule-slots";

// WHAT IS WAITING ON THE CANDIDATE (challenge-r06 application-status-page/B).
//
// At interview and offer stage the public status page used to say "watch your email":
// it delegated to an inbox the candidate may have lost, while the server knew exactly
// what was pending. This module names it, as a projection a stranger may read.
//
// The status link is FORWARDABLE (registry: candidate-safe-status-projection, "assume
// the payload is public"). So the projection names the action and its dates and NEVER
// the capability: a forwarded status link that carried the offer token would let
// whoever holds it accept or decline the offer. The link itself stays where it was
// issued, the inbox, and the page gets a "send it to my email again" door instead
// (candidate-next-action-server.ts, the same doctrine as apply-link-recovery.ts).
//
// Pure: no DB, no clock of its own. The server half reads the three stores and passes
// plain rows in; tests drive it with fixtures.

export const NEXT_ACTION_KINDS = ["answer_offer", "book_interview", "take_interview"] as const;
export type NextActionKind = (typeof NEXT_ACTION_KINDS)[number];

/** The whole public projection. Three keys, stated: adding a field is a deliberate act
 *  (status-letter.test.ts / status-recording.test.ts pin the payload's key set). */
export type CandidateNextAction = {
  kind: NextActionKind;
  /** When the capability was issued to the candidate (ISO). */
  sentAt: string;
  /** When it stops working (ISO), or null when it has no deadline (a legacy offer). */
  expiresAt: string | null;
};

/** Mirrors INTERVIEW_LINK_TTL_DAYS in db/interviews.ts. Restated rather than imported so
 *  this module stays off the DB graph; candidate-next-action.test.ts pins the two equal. */
export const INTERVIEW_INVITE_TTL_DAYS = 7;

const DAY_MS = 86_400_000;

export type NextActionInput = {
  /** The pipeline entry's status (active | rejected | declined | rematched | role_closed). */
  entryStatus: string;
  /** Erased/anonymized entries have nothing waiting: they are not a person any more. */
  anonymized?: boolean;
  invites: { status: string; createdAt: string; attendanceStatus?: string | null; attendanceAt?: string | null }[];
  openOffer: { status: string; createdAt: string; expiresAt: string | null } | null;
  interview: { mode: string; status: string; createdAt: string } | null;
  nowMs: number;
};

function isoPlusDays(iso: string, days: number): string | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms + days * DAY_MS).toISOString();
}

/** The anchor isScheduleInviteExpired counts the TTL from: a cancel-reopened invite
 *  restarts its clock at the cancel stamp. Same derivation, so the stated deadline and
 *  the booking page's own "expired" answer never disagree. */
function inviteAnchor(invite: NextActionInput["invites"][number]): string {
  if (invite.attendanceStatus === "cancelled" && invite.attendanceAt) {
    const reopened = Date.parse(invite.attendanceAt);
    if (!Number.isNaN(reopened) && reopened > Date.parse(invite.createdAt)) return invite.attendanceAt;
  }
  return invite.createdAt;
}

/** The booking invite the page points at: the newest still-pending, unexpired one. The
 *  server half resends THIS row, so the page and the letter can never name different
 *  invitations. */
export function pickLiveInvite<I extends NextActionInput["invites"][number]>(invites: I[], nowMs: number): I | null {
  return (
    invites
      .filter((i) => i.status === "pending" && !isScheduleInviteExpired(i, nowMs))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null
  );
}

/** The one thing the candidate is expected to do next, or null. Precedence: an open
 *  offer (it carries the hardest deadline and the highest stakes) > a booking invite >
 *  an untaken AI interview. A dead capability (expired, lapsed, completed, revoked) is
 *  never pointed at; a closed or erased application has nothing waiting. The result is
 *  built key by key, so no field of an input row can ride through. */
export function candidateNextAction(input: NextActionInput): CandidateNextAction | null {
  if (input.entryStatus !== "active" || input.anonymized) return null;
  const now = input.nowMs;

  const offer = input.openOffer;
  if (offer && offer.status === "extended") {
    const deadline = offer.expiresAt ? Date.parse(offer.expiresAt) : null;
    if (deadline === null || (!Number.isNaN(deadline) && deadline > now)) {
      return { kind: "answer_offer", sentAt: offer.createdAt, expiresAt: offer.expiresAt ?? null };
    }
  }

  const live = pickLiveInvite(input.invites, now);
  if (live) {
    return { kind: "book_interview", sentAt: live.createdAt, expiresAt: isoPlusDays(inviteAnchor(live), INVITE_LINK_TTL_DAYS) };
  }

  const iv = input.interview;
  if (iv && iv.mode === "candidate" && iv.status === "created") {
    const expiresAt = isoPlusDays(iv.createdAt, INTERVIEW_INVITE_TTL_DAYS);
    if (expiresAt && Date.parse(expiresAt) > now) return { kind: "take_interview", sentAt: iv.createdAt, expiresAt };
  }
  return null;
}

// ---- the resend decision ----------------------------------------------------

export type ActionResendSkip = "no_contact" | "anonymized" | "cooldown";
export type ActionResendDecision = { send: true } | { send: false; reason: ActionResendSkip };

/** One resend per entry per 24 hours, whoever asks: the thing protected is the
 *  candidate's inbox, and a forwarded status link must not become a mail cannon. */
export const ACTION_RESEND_THROTTLE = { limit: 1, windowMs: 24 * 60 * 60_000 };

/** Whether to re-send the pending capability. Pure. Same order and reasons as
 *  decideLinkRecovery (apply-link-recovery.ts): only an address already on the entry,
 *  never an anonymized record, at most once per cooldown. `relayConfigured` does not
 *  gate the send — with no relay the dispatch records an honest `queued` Outbox row. */
export function decideActionResend(input: {
  contact: string | null | undefined;
  anonymized: boolean;
  throttled: boolean;
  relayConfigured?: boolean;
}): ActionResendDecision {
  if (!(input.contact ?? "").trim()) return { send: false, reason: "no_contact" };
  if (input.anonymized) return { send: false, reason: "anonymized" };
  if (input.throttled) return { send: false, reason: "cooldown" };
  return { send: true };
}

/** The `status.nextAction.*` sentence the door answers with. Takes ONLY the relay
 *  state: a send, a cooldown and an entry with no address on file all get the same
 *  sentence, so the answer reveals nothing about what is on file. */
export function resendMessageKey(relayConfigured: boolean): "resent" | "resentNoRelay" {
  return relayConfigured ? "resent" : "resentNoRelay";
}
