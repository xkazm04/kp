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

/** One busy window from a provider. Half-open [start, end) — the convention Google uses. */
export type BusyInterval = { start: string; end: string };

/** Default interview length when a caller does not say. Matches the scheduling copy's
 *  assumption; passed explicitly wherever a real duration is known. */
export const DEFAULT_SLOT_MINUTES = 45;

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
