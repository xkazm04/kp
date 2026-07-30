import { proposeSlots } from "../schedule-slots";
import { busyQueryWindow, filterFreeSlots, DEFAULT_SLOT_MINUTES } from "./free-busy";
import { fetchBusy } from "./google-calendar";

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
   *  claims a slot is calendar-confirmed when nothing was checked. */
  calendarChecked: boolean;
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
  const candidates = proposeSlots(taken, count * OVERFETCH);
  const window = busyQueryWindow(candidates, minutes);
  if (!window) return { slots: candidates.slice(0, count), calendarChecked: false, droppedForConflict: 0 };

  const busy = await fetchBusy(window, workspaceId);
  if (busy === null) {
    // Unknown, not free. Fall back to the pre-integration list rather than pretending.
    return { slots: candidates.slice(0, count), calendarChecked: false, droppedForConflict: 0 };
  }

  const { free, droppedForConflict } = filterFreeSlots(candidates, busy, minutes);
  // A genuinely full horizon yields zero, and that is the TRUE answer — the existing
  // no-slots escalation ("propose your own times") is exactly the right response to it,
  // so this does not backfill with times the recruiter cannot make.
  return { slots: free.slice(0, count), calendarChecked: true, droppedForConflict };
}
