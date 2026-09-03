// WHERE FOCUS GOES WHEN THE SCHEDULING SURFACE SWAPS.
//
// /schedule/[token] replaces its whole body three times over one session: the slot grid
// becomes the booked card, the booked card becomes the grid again after an RSVP cancel or
// a "different time", and any of them becomes the dead-link card when the invite closes.
// Every one of those swaps unmounts the element the candidate's focus was on, so focus
// falls to <body>: a keyboard user has to tab from the top of the document to find out
// whether their booking landed, and a screen-reader user is left on nothing at all.
//
// The ordering below is the SAME ordering SchedulePicker renders by — a dead link beats a
// booking, a booking beats the picker unless the candidate opted into rescheduling — kept
// here as one pure function so the focus target can never disagree with what is on screen,
// and so it is unit-testable without a DOM (the repo's unit runner has no renderer).

export const SCHEDULE_SURFACES = ["dead", "booked", "picker"] as const;

export type ScheduleSurface = (typeof SCHEDULE_SURFACES)[number];

/** The state SchedulePicker decides on, and nothing else. */
export type ScheduleSurfaceState = {
  closedReason: string | null;
  confirmed: string | null;
  rescheduling: boolean;
};

/** Which surface is on screen for this state. Mirrors SchedulePicker's own branch order. */
export function scheduleSurface(state: ScheduleSurfaceState): ScheduleSurface {
  if (state.closedReason) return "dead";
  if (state.confirmed && !state.rescheduling) return "booked";
  return "picker";
}

/** The element each surface offers as its focus anchor — the card's own heading, or the
 *  grid's labelled group. Every surface component renders its id with `tabIndex={-1}`, so
 *  the anchor is programmatically focusable without becoming a tab stop of its own. */
export const SCHEDULE_FOCUS_ID: Record<ScheduleSurface, string> = {
  dead: "schedule-dead-link-heading",
  booked: "schedule-booked-heading",
  picker: "schedule-picker-group",
};
