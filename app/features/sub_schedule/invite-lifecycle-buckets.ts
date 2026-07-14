// bug-ui-scan-2026-07-09 (interview-scheduling-prep-rubric #3) — pure bucketing
// for InviteLifecyclePanel, extracted from the .tsx so the today/upcoming/awaiting
// partition is unit-testable (node --test can't load JSX).
//
// The panel used to compute `upcoming` as `confirmed && Date.parse(slotAt) >= now`.
// A confirmed interview therefore VANISHED from the entire panel the instant its
// start passed: it couldn't be `upcoming` (now in the past), couldn't be `awaiting`
// (that bucket is `status !== "confirmed"`), and couldn't be `attention` (only
// flagged rows) — so the recruiter lost sight of the call they were about to run
// (or had just finished and needed to mark no-show / next-step). This adds a
// "today / in-progress / recent" bucket that keeps at-or-just-past confirmed slots
// visible until a grace window closes, and removes the `>=`-at-`loadedAt` flicker
// (a slot equal to "now" now stays visible either way).

// Type-only: erased at runtime, so schedule-store's better-sqlite3 is NOT pulled
// into this module (or into a bare `node --test` process).
import type { ScheduleInvite } from "@/app/_lib/schedule-store";
// Pure (no better-sqlite3) — safe in this client-bundled module. Derives the
// "expired" fate of a stale, never-booked pending invite (Direction 1).
import { isScheduleInviteExpired } from "@/app/_lib/schedule-slots";
// Pure, import-free contract — the SAME rule the reminder sweep uses to decide an
// entry has left the interview track. Reused here so the Closed-bucket re-invite and
// the reminder eligibility can't drift.
import { isEntryReminderEligible } from "@/app/_lib/pipeline-status";

// How long a just-started confirmed slot stays in the "today" bucket after its
// start — long enough to cover the interview itself plus immediate no-show /
// next-step follow-up, short enough that old bookings don't accrete in a live
// agenda (the panel is not a history log).
export const RECENT_WINDOW_MS = 4 * 60 * 60 * 1000; // 4h

export type InviteBuckets = {
  attention: ScheduleInvite[];
  upcoming: ScheduleInvite[];
  today: ScheduleInvite[];
  awaiting: ScheduleInvite[];
  // Direction 1 — the terminal fates that used to have no home: declined, no_show,
  // and the derived `expired` (a pending link aged past the TTL). Kept as a
  // collapsed, low-emphasis section so every interview has an honest end state
  // instead of silently vanishing from the agenda.
  closed: ScheduleInvite[];
};

/** The label for an invite's closed fate, or null when it isn't closed. Shared by
 *  the panel so the rendered reason can't drift from the bucketing. `expired` is
 *  derived from a pending row's age; `declined` / `no_show` are stored statuses. */
export function closedReason(invite: ScheduleInvite, nowMs: number): "expired" | "declined" | "no_show" | null {
  if (invite.status === "declined") return "declined";
  if (invite.status === "no_show") return "no_show";
  if (isScheduleInviteExpired(invite, nowMs)) return "expired";
  return null;
}

/** Whether a CLOSED invite (declined / no_show / expired) can be re-invited — i.e. the
 *  recruiter can mint a fresh scheduling link for its candidate. Offered only when the
 *  linked pipeline entry is still on the interview track: a terminal entry (rejected/
 *  declined) or a Hired one gets NO re-invite, checked with the same rule the reminder
 *  sweep uses (isEntryReminderEligible), so the two can't drift. A closed invite with no
 *  linked entry (orphan) or one the agenda read didn't join stays re-invitable (null →
 *  eligible), mirroring the reminder rule. Requires an entryId — the invite route keys
 *  the fresh link on it. `nowMs` decides the derived `expired` fate. */
export function canReinvite(invite: ScheduleInvite, nowMs: number): boolean {
  if (closedReason(invite, nowMs) === null) return false; // only a closed invite re-invites
  if (!invite.entryId) return false; // no entry to key the fresh link on
  return isEntryReminderEligible(
    invite.entryStatus ? { status: invite.entryStatus, stage: invite.entryStage ?? "" } : null
  );
}

/** Whether an invite carries a pending candidate "propose your own times" escalation
 *  the recruiter must accept (per time) or decline. Attention-worthy: the candidate is
 *  stuck (horizon booked, or past the self-reschedule cap) and waiting on a human. */
export function hasPendingProposals(invite: ScheduleInvite): boolean {
  return invite.proposalStatus === "pending" && (invite.proposals?.length ?? 0) > 0;
}

/** Partition invites for the lifecycle panel. `nowMs` is captured at load time so
 *  the split is a pure function of state during render. */
export function bucketInvites(
  invites: ScheduleInvite[],
  nowMs: number,
  recentWindowMs: number = RECENT_WINDOW_MS
): InviteBuckets {
  // Terminal fates first (Direction 1): a declined / no_show / expired invite is
  // closed — it must not appear as an actionable attention/awaiting row even if a
  // stale flag (needsReconcile) lingers on it.
  const closed = invites.filter((i) => closedReason(i, nowMs) !== null);
  const live = invites.filter((i) => !closed.includes(i));
  const attention = live.filter((i) => i.needsMoreSlots || i.needsReconcile || hasPendingProposals(i));
  const rest = live.filter((i) => !attention.includes(i));

  const upcoming: ScheduleInvite[] = [];
  const today: ScheduleInvite[] = [];
  const awaiting: ScheduleInvite[] = [];

  for (const i of rest) {
    if (i.status === "confirmed" && i.slotAt) {
      const slotMs = Date.parse(i.slotAt);
      if (Number.isNaN(slotMs)) {
        // Unparsable slot on a confirmed row — surface it rather than silently drop
        // it (the panel renders the raw label / a fallback).
        awaiting.push(i);
      } else if (slotMs >= nowMs) {
        upcoming.push(i);
      } else if (nowMs - slotMs <= recentWindowMs) {
        today.push(i);
      }
      // else: a confirmed interview older than the grace window — intentionally not
      // shown; keeping it would grow the agenda without bound.
    } else if (i.status !== "confirmed") {
      awaiting.push(i);
    }
    // A confirmed invite with no slotAt can't occur (confirm always stamps slot_at);
    // it falls through to no bucket rather than fabricate a placeholder row.
  }

  upcoming.sort((a, b) => Date.parse(a.slotAt as string) - Date.parse(b.slotAt as string));
  // Most-recent first: the in-progress / just-finished call the recruiter most
  // likely needs is at the top of the "today" list.
  today.sort((a, b) => Date.parse(b.slotAt as string) - Date.parse(a.slotAt as string));
  // Closed rows newest-first (by confirm time, else creation) so the most recent
  // terminal outcome leads the collapsed history.
  closed.sort((a, b) => Date.parse(b.confirmedAt ?? b.createdAt) - Date.parse(a.confirmedAt ?? a.createdAt));

  return { attention, upcoming, today, awaiting, closed };
}

/** Whether a confirmed slot is currently in progress at `nowMs` (started, not yet
 *  past its planned end). Needs a known duration; returns false when it's unknown
 *  so the UI shows no misleading "in progress" chip. */
export function isInProgress(slotAt: string | null, durationMin: number | null, nowMs: number): boolean {
  if (!slotAt || !durationMin || durationMin <= 0) return false;
  const start = Date.parse(slotAt);
  if (Number.isNaN(start)) return false;
  return nowMs >= start && nowMs < start + durationMin * 60_000;
}
