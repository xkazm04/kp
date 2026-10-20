// What a pending card on the Schedule tab should offer FIRST, derived from the
// candidate's live invite (challenge-r02 schedule-calendar-invites/B).
//
// Every pending card used to carry one booking action, Confirm, rendered the same
// whether the cell came from a confirmed invite or from the flat "Tue 14:00" guess,
// and the `book` route mails the candidate nothing. So a recruiter could slot a
// candidate nobody had asked into a default hour with one click, while the facts
// that should decide the next step (a link sent three days ago, two times the
// candidate proposed, a candidate stalled on a fully booked horizon) lived only in
// the lifecycle panel, keyed by invite instead of by the candidate on the card.
//
// The product rule the code already states (ScheduleCalendar.tsx,
// ScheduleInviteRecruiterControls.tsx): interview times come from the candidate's
// own link or their proposals. This resolver puts that step first and keeps booking
// the suggested time as a secondary, labelled control, so no current path is lost
// (the guided simulation still clicks it).
//
// Pure and data-only: ScheduleInvite is type-only, so better-sqlite3 stays out of the
// client bundle.

import type { ScheduleInvite } from "@/app/_lib/schedule-store";
import { isScheduleInviteExpired } from "@/app/_lib/schedule-slots";
import type { SchedEntry } from "./ScheduleTypes";
import type { SlotSource } from "./scheduleGridSeeds";
import { hasPendingProposals } from "./scheduleInviteLifecycleBuckets";

export const PENDING_CARD_KINDS = [
  "no_link",
  "awaiting",
  "expired",
  "closed",
  "proposals",
  "stuck_no_slots",
  "booked",
] as const;
export type PendingCardKind = (typeof PENDING_CARD_KINDS)[number];

/** The card's first action. `see_attention` is a pointer, not a button: the
 *  needs-more-slots stall is answered in the lifecycle panel's attention row. */
export type PendingCardPrimary =
  | "send_link"
  | "copy_link"
  | "reinvite"
  | "accept_proposal"
  | "see_attention"
  | "confirm";

export type PendingCardState = {
  kind: PendingCardKind;
  primary: PendingCardPrimary;
  /** True when the card's cell is a suggestion (no confirmed invite backs it): the
   *  book control is then secondary and labelled as booking a suggested time. */
  bookSuggested: boolean;
  /** The live invite's token (copy link, accept a proposal); null with no invite. */
  token: string | null;
  /** When the awaiting link was minted. */
  sentAt: string | null;
  /** The candidate's proposed times, when they are waiting on the recruiter. */
  proposals: { value: string; label: string }[];
  /** Why a closed invite closed. */
  closedReason: "declined" | "no_show" | null;
};

type InviteRank = 0 | 1 | 2;
function rank(inv: ScheduleInvite, nowMs: number): InviteRank {
  if (inv.status === "confirmed") return 0;
  if (inv.status === "pending" && !isScheduleInviteExpired(inv, nowMs)) return 1;
  return 2; // expired pending, declined, no_show: history
}

/** The one invite that speaks for an entry's card. The agenda can hold several per
 *  entry (a re-invite history), and the grid used to keep whichever sorted LAST in the
 *  agenda read's ORDER BY. Chosen deliberately instead: a confirmed booking, else a
 *  live pending link, else the most recent closed one; newest first within a rank. */
export function liveInviteFor(
  entryId: string,
  invites: readonly ScheduleInvite[],
  nowMs: number
): ScheduleInvite | null {
  let best: ScheduleInvite | null = null;
  let bestRank: InviteRank = 2;
  let bestAt = -Infinity;
  for (const inv of invites) {
    if (inv.entryId !== entryId) continue;
    const r = rank(inv, nowMs);
    const at = Date.parse(inv.createdAt);
    const atN = Number.isNaN(at) ? -Infinity : at;
    if (!best || r < bestRank || (r === bestRank && atN > bestAt)) {
      best = inv;
      bestRank = r;
      bestAt = atN;
    }
  }
  return best;
}

function state(kind: PendingCardKind, primary: PendingCardPrimary, over: Partial<PendingCardState> = {}): PendingCardState {
  return {
    kind,
    primary,
    bookSuggested: kind !== "booked",
    token: null,
    sentAt: null,
    proposals: [],
    closedReason: null,
    ...over,
  };
}

/** Resolve a pending card from its entry, its live invite (liveInviteFor), where its
 *  seeded cell came from, and "now" (captured at load, so render stays pure). */
export function pendingCardState(
  _entry: SchedEntry,
  invite: ScheduleInvite | null,
  pickSource: SlotSource | undefined,
  nowMs: number
): PendingCardState {
  if (!invite) return state("no_link", "send_link");
  const token = invite.token;
  const live = invite.status === "confirmed" || (invite.status === "pending" && !isScheduleInviteExpired(invite, nowMs));
  // The candidate is waiting on the recruiter: answer that before anything else.
  if (live && hasPendingProposals(invite)) {
    return state("proposals", "accept_proposal", { token, proposals: [...(invite.proposals ?? [])] });
  }
  if (live && invite.needsMoreSlots) return state("stuck_no_slots", "see_attention", { token });
  if (invite.status === "confirmed") {
    // Confirm is primary only when the cell IS the confirmed booking.
    if (pickSource === "booked") return state("booked", "confirm", { token });
    return state("awaiting", "copy_link", { token, sentAt: invite.createdAt });
  }
  if (invite.status === "pending") {
    if (isScheduleInviteExpired(invite, nowMs)) return state("expired", "reinvite", { token });
    return state("awaiting", "copy_link", { token, sentAt: invite.createdAt });
  }
  if (invite.status === "declined" || invite.status === "no_show") {
    return state("closed", "reinvite", { token, closedReason: invite.status });
  }
  return state("no_link", "send_link");
}

/** The card's book control: always rendered (the guided simulation clicks it), but
 *  labelled and weighted by whether the cell is a fact or a suggestion. */
export function bookControlFor(s: PendingCardState): {
  label: "confirm" | "bookSuggested";
  emphasis: "primary" | "secondary";
} {
  return s.bookSuggested
    ? { label: "bookSuggested", emphasis: "secondary" }
    : { label: "confirm", emphasis: "primary" };
}

/** The toast for a send-link answer, from the route's TRUTHFUL delivery claim
 *  (sent only on a relayed 2xx, queued when the outbox is the terminal target).
 *  No claim is never read as a delivery. Keys are under `scheduleTab`. */
export function sendLinkNotice(body: { delivery?: unknown }): {
  key: "sendLink.sent" | "sendLink.queued" | "sendLink.failed";
  variant: "success" | "info" | "error";
} {
  if (body.delivery === "sent") return { key: "sendLink.sent", variant: "success" };
  if (body.delivery === "queued") return { key: "sendLink.queued", variant: "info" };
  return { key: "sendLink.failed", variant: "error" };
}
