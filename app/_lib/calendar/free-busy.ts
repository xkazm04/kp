// W1.4 — free/busy reasoning. Pure, so the rule that decides whether a recruiter gets
// double-booked is testable without a Google account.
//
// kp already proposes slots (schedule-slots.proposeSlots) and already skips ones another
// kp candidate holds. What it could not see is the rest of the recruiter's day: the
// standup, the 1:1, the dentist. So every "pick a time" link cheerfully offered slots the
// recruiter was already busy for, and the collision surfaced as a human apology later.
//
// A Google free/busy query returns opaque busy INTERVALS (no titles, no attendees — the
// narrow `calendar.freebusy` scope cannot see them, which is deliberate: kp needs to know
// *that* you are busy, never *why*).

import { DEFAULT_INTERVIEW_MINUTES } from "./constants";

/** One busy window from a provider. Half-open [start, end) — the convention Google uses. */
export type BusyInterval = { start: string; end: string };

/** Default interview length when a caller does not say; passed explicitly wherever a real
 *  duration is known. Re-exported from constants.ts — this file and calendar-links.ts each
 *  declared their own 45, so the recruiter's event and the candidate's .ics could drift
 *  apart the moment either changed. One number, two names, one source. */
export const DEFAULT_SLOT_MINUTES = DEFAULT_INTERVIEW_MINUTES;

/**
 * WAS the calendar consulted, and if not, WHY — the honest three-state a human can act on.
 *
 * `fetchBusy` already distinguishes null ("unknown") from [] ("checked, nothing in the
 * way"). Collapsing that to a bare boolean at the UI boundary made a Google outage, a
 * revoked grant and a genuinely clear calendar indistinguishable. These are the three
 * states anyone reading a slot list needs:
 *   checked        — a connected calendar answered; the offered times are conflict-free.
 *   not_connected  — no calendar integration for this workspace (nothing to check against).
 *   unavailable    — a calendar IS connected but the lookup produced no answer (outage,
 *                    revoked grant, a per-calendar error). NEVER rendered as "free".
 *
 * CANONICAL LIST. The recruiter-facing catalog (`scheduleTab.lifecycle.calendarStatus.*`)
 * is set-equality guarded against it in all four locales by calendar-status-i18n.test.ts —
 * adding a state here without translating it fails that test rather than rendering English
 * into a German UI.
 */
export const CALENDAR_STATUSES = ["checked", "not_connected", "unavailable"] as const;
export type CalendarStatus = (typeof CALENDAR_STATUSES)[number];

/**
 * WHAT HAPPENED to the interview's own event on the connected calendar — the write-back
 * axis, as opposed to `CALENDAR_STATUSES` above, which is the free/busy READ axis.
 *
 * Two axes, deliberately not one vocabulary: "we could not check your calendar for
 * conflicts" and "we could not put the interview on your calendar" are different facts
 * with different repairs, and a booking routinely holds one of each. `not_connected` is
 * spelled the same in both because it means the same thing in both (nothing to talk to)
 * and `isCalendarConnected` is the single source for it.
 *   written       — the event exists on the calendar; its id + link are on the invite.
 *   not_connected — no calendar integration for this workspace; link-only (.ics /
 *                   "add to calendar") behaviour, exactly as before this integration.
 *   failed        — a calendar IS connected and the write did not land (outage, revoked
 *                   grant, API error). The BOOKING still stands — it is the source of
 *                   truth — so this is recorded rather than raised.
 *   removed       — the interview was cancelled/declined/no-showed and its event was
 *                   deleted from the calendar. Nothing is orphaned.
 *   orphaned      — the interview was closed but its event could NOT be deleted, so a
 *                   stale entry is still sitting on someone's calendar. The one state
 *                   that asks a human to go and remove it by hand.
 *
 * CANONICAL LIST, same contract as CALENDAR_STATUSES: the recruiter catalog
 * (`scheduleTab.lifecycle.calendarEvent.*`) is set-equality guarded against it in all
 * four locales by calendar-status-i18n.test.ts.
 */
export const CALENDAR_EVENT_STATES = ["written", "not_connected", "failed", "removed", "orphaned"] as const;
export type CalendarEventState = (typeof CALENDAR_EVENT_STATES)[number];

type Span = { startMs: number; endMs: number };

function toSpan(interval: BusyInterval): Span | null {
  const startMs = Date.parse(interval?.start ?? "");
  const endMs = Date.parse(interval?.end ?? "");
  // A malformed or inverted interval is DROPPED, not treated as busy-forever: a provider
  // hiccup must not silently empty a recruiter's availability, which would look like
  // "no slots available" with no explanation. Losing one interval risks one double
  // booking a human can fix; treating garbage as busy blocks scheduling entirely.
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return null;
  return { startMs, endMs };
}

/** Merge overlapping/adjacent busy spans so overlap checks are linear and stable. */
export function normalizeBusy(intervals: readonly BusyInterval[]): Span[] {
  const spans = intervals.map(toSpan).filter((s): s is Span => s !== null).sort((a, b) => a.startMs - b.startMs);
  const out: Span[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    // Adjacent counts as contiguous: back-to-back meetings leave no real gap.
    if (last && s.startMs <= last.endMs) last.endMs = Math.max(last.endMs, s.endMs);
    else out.push({ ...s });
  }
  return out;
}

/**
 * Is `slotIso` free against `busy`, for a meeting of `minutes`?
 *
 * Half-open on both sides: a slot starting exactly when a meeting ends is FREE, and a slot
 * ending exactly when one starts is FREE. Anything else would refuse the most common real
 * booking — the one immediately after the standup.
 *
 * An unparseable slot is reported BUSY. That inverts the guard above deliberately: there,
 * bad provider data must not erase availability; here, a slot we cannot even place in time
 * must never be offered as confirmed-free.
 */
export function isSlotFree(busy: readonly BusyInterval[], slotIso: string, minutes: number = DEFAULT_SLOT_MINUTES): boolean {
  const startMs = Date.parse(slotIso);
  if (Number.isNaN(startMs)) return false;
  const endMs = startMs + Math.max(1, minutes) * 60_000;
  return !normalizeBusy(busy).some((b) => startMs < b.endMs && b.startMs < endMs);
}

/**
 * Filter proposed slots down to the ones the calendar says are actually free.
 *
 * Returns the kept slots plus the count dropped, because "we found you 3 times" reads very
 * differently from "we found you 3 of 6 times, the rest clashed" — and a recruiter who
 * sees an unexplained short list assumes the feature is broken.
 */
export function filterFreeSlots<T extends { value: string }>(
  slots: readonly T[],
  busy: readonly BusyInterval[],
  minutes: number = DEFAULT_SLOT_MINUTES
): { free: T[]; droppedForConflict: number } {
  if (busy.length === 0) return { free: [...slots], droppedForConflict: 0 };
  const normalized = normalizeBusy(busy);
  const free = slots.filter((s) => isSlotFree(normalized.map((n) => ({ start: new Date(n.startMs).toISOString(), end: new Date(n.endMs).toISOString() })), s.value, minutes));
  return { free, droppedForConflict: slots.length - free.length };
}

/**
 * How many of the slots a caller would ACTUALLY have offered the calendar removed.
 *
 * `filterFreeSlots` counts drops across the whole candidate pool, and callers over-fetch
 * (available-slots.ts asks for `count * OVERFETCH` so a busy week still yields a full
 * list). That makes the raw drop count an implementation detail: a clash at candidate #20
 * costs a caller who only ever shows 6 slots nothing at all, yet it would still print
 * "6 times hidden as busy" beside a complete six-slot list — telling a recruiter their
 * calendar cost them slots when it cost them none, which is the same species of lie the
 * three-state `CalendarStatus` above exists to avoid.
 *
 * So: compare what could have been offered (`min(offerCount, candidateCount)`) against what
 * survived into the offer (`min(offerCount, freeCount)`). Zero whenever the list is full.
 */
export function droppedFromOffer(offerCount: number, candidateCount: number, freeCount: number): number {
  return Math.max(0, Math.min(offerCount, candidateCount) - Math.min(offerCount, freeCount));
}

/** The [timeMin, timeMax) window to ask a provider about, derived from the slots we care
 *  about — so a free/busy query never pulls more of someone's calendar than the decision
 *  needs. Null when there is nothing to ask about. */
export function busyQueryWindow(
  slots: readonly { value: string }[],
  minutes: number = DEFAULT_SLOT_MINUTES
): { timeMin: string; timeMax: string } | null {
  const times = slots.map((s) => Date.parse(s.value)).filter((n) => !Number.isNaN(n));
  if (times.length === 0) return null;
  return {
    timeMin: new Date(Math.min(...times)).toISOString(),
    timeMax: new Date(Math.max(...times) + Math.max(1, minutes) * 60_000).toISOString(),
  };
}
