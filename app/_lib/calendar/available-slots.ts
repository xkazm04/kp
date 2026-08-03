import { proposeSlots } from "../schedule-slots";
import { busyQueryWindow, filterFreeSlots, isSlotFree, DEFAULT_SLOT_MINUTES, type CalendarStatus } from "./free-busy";
import { fetchBusy, isCalendarConnected } from "./google-calendar";

export { CALENDAR_STATUSES, type CalendarStatus } from "./free-busy";

// W1.4 — the one place slot proposal meets the real calendar.
//
// `proposeSlots` already skips times another kp candidate holds. This wraps it so it also
// skips times the recruiter's own calendar holds — the standup, the 1:1, the dentist —
// which is the whole difference between "pick a time" and "pick a time I can actually make".

/** How many extra candidate slots to generate before filtering. A recruiter with a busy
 *  week loses most of a bare six, and handing a candidate two options reads as "we are not
 *  really trying". Over-fetching costs nothing: proposeSlots is pure local arithmetic. */
const OVERFETCH = 4;

export type ProposedSlots = {
  slots: { value: string; label: string }[];
  /** True only when a calendar was actually consulted. False covers every "we do not
   *  know" case — unconfigured, disconnected, revoked, Google down — so a caller never
   *  claims a slot is calendar-confirmed when nothing was checked. Always
   *  `calendarStatus === "checked"`; kept as the one-bit form the wire already carries. */
  calendarChecked: boolean;
  /** WHY the calendar was or was not consulted (free-busy.ts CALENDAR_STATUSES). The
   *  boolean above cannot separate "no calendar connected" (the recruiter can fix that)
   *  from "the lookup failed" (they cannot) — and a product that renders both as a clear
   *  calendar is lying twice. */
  calendarStatus: CalendarStatus;
  /** How many otherwise-offerable slots the calendar removed. Surfaced so a short list
   *  reads as "your calendar is busy" rather than as a broken feature. */
  droppedForConflict: number;
};

/**
 * Propose slots that are free in kp AND on the connected calendar.
 *
 * DEGRADES TO TODAY'S BEHAVIOUR. If no calendar is connected, or the lookup fails, the
 * caller gets exactly the list `proposeSlots` would have returned — scheduling worked
 * before this integration and must keep working when Google does not. That is why
 * `fetchBusy` distinguishes null ("unknown") from [] ("checked, nothing in the way"):
 * treating an outage as an empty calendar would confidently offer busy times.
 */
export async function proposeFreeSlots(
  taken: string[],
  workspaceId: string,
  count = 6,
  minutes = DEFAULT_SLOT_MINUTES
): Promise<ProposedSlots> {
  // The unchecked outcome, with the reason a human can act on: "connect a calendar" is a
  // fix, "the lookup failed" is a wait. Never "checked" — that word is reserved for a
  // provider answer we actually hold.
  const unchecked = (slots: ProposedSlots["slots"]): ProposedSlots => ({
    slots,
    calendarChecked: false,
    calendarStatus: isCalendarConnected(workspaceId) ? "unavailable" : "not_connected",
    droppedForConflict: 0,
  });

  const candidates = proposeSlots(taken, count * OVERFETCH);
  const window = busyQueryWindow(candidates, minutes);
  // Nothing to ask about (the kp horizon is already full). Reported as unchecked, because
  // it is — the caller renders its "all taken" card here and shows no calendar claim.
  if (!window) return unchecked(candidates.slice(0, count));

  const busy = await fetchBusy(window, workspaceId);
  if (busy === null) {
    // Unknown, not free. Fall back to the pre-integration list rather than pretending.
    return unchecked(candidates.slice(0, count));
  }

  const { free, droppedForConflict } = filterFreeSlots(candidates, busy, minutes);
  // A genuinely full horizon yields zero, and that is the TRUE answer — the existing
  // no-slots escalation ("propose your own times") is exactly the right response to it,
  // so this does not backfill with times the recruiter cannot make.
  return { slots: free.slice(0, count), calendarChecked: true, calendarStatus: "checked", droppedForConflict };
}

/**
 * Is `slotIso` STILL free on the connected calendar, right now?
 *
 * The suggestion-time filter above runs when a candidate loads the page; the booking
 * happens minutes or days later. Nothing re-checked in between, so a slot that filled on
 * the interviewer's calendar in that gap was booked straight into the conflict — the exact
 * double-booking this integration exists to prevent, arriving through the front door.
 *
 * THREE-VALUED ON PURPOSE, and the third value is the important one:
 *   true  — checked, free. Proceed.
 *   false — checked, busy. The caller must refuse and re-offer.
 *   null  — UNKNOWN (no calendar connected, or the lookup failed). The caller MUST
 *           proceed. An outage may never block a booking: scheduling worked before this
 *           integration and must keep working when Google does not. A guard that fails
 *           closed would turn a Google incident into "nobody can book an interview".
 */
export async function slotStillFree(
  slotIso: string,
  workspaceId: string,
  minutes = DEFAULT_SLOT_MINUTES
): Promise<boolean | null> {
  const window = busyQueryWindow([{ value: slotIso }], minutes);
  if (!window) return null; // unplaceable instant — offeredSlotFor owns that rejection
  const busy = await fetchBusy(window, workspaceId);
  if (busy === null) return null;
  return isSlotFree(busy, slotIso, minutes);
}
