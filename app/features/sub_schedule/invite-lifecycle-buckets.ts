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
};

/** Partition invites for the lifecycle panel. `nowMs` is captured at load time so
 *  the split is a pure function of state during render. */
export function bucketInvites(
  invites: ScheduleInvite[],
  nowMs: number,
  recentWindowMs: number = RECENT_WINDOW_MS
): InviteBuckets {
  const attention = invites.filter((i) => i.needsMoreSlots || i.needsReconcile);
  const rest = invites.filter((i) => !attention.includes(i));

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

  return { attention, upcoming, today, awaiting };
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
