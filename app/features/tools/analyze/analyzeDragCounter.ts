// The enter/leave arithmetic behind a drop zone's highlight, as a pure reducer.
//
// A drop zone is not a single element: it is a label wrapping an icon, a title
// and a hint. `dragenter` and `dragleave` fire for EACH of those as the cursor
// crosses them, so a zone that stores a boolean flips it off the instant the
// pointer moves from the label onto its own icon — the highlight strobes while
// the user is still squarely inside the target, and on the frame where it reads
// "not over" the zone looks like it will not accept the file.
//
// Counting solves it: enter increments, leave decrements, and the highlight is on
// while the count is positive. The window-level hook (useAnalyzeGlobalFileDrag)
// has always done this with a `dragCounter`; the per-zone hook had a bare
// `setIsOver(false)` on leave. This module is that arithmetic in one testable
// place, including the terminal resets a counter without them is notorious for
// needing — an ESC-cancelled drag or a file released outside the window may never
// send the balancing leave, so `drop` and `dragend` hard-reset rather than
// decrement, and the count clamps at zero so a stray leave cannot drive it
// negative (which would then swallow the next genuine enter).

export const DRAG_COUNTER_EVENTS = ["enter", "leave", "drop", "end"] as const;
export type DragCounterEvent = (typeof DRAG_COUNTER_EVENTS)[number];

export function isDragCounterEvent(value: unknown): value is DragCounterEvent {
  return typeof value === "string" && (DRAG_COUNTER_EVENTS as readonly string[]).includes(value);
}

/** The next depth after `event`. Never negative; `drop`/`end` are terminal. */
export function nextDragDepth(depth: number, event: DragCounterEvent): number {
  switch (event) {
    case "enter":
      return depth + 1;
    case "leave":
      return Math.max(0, depth - 1);
    case "drop":
    case "end":
      return 0;
  }
}

/** Whether the zone should render its active/over styling at this depth. */
export function isDragActive(depth: number): boolean {
  return depth > 0;
}
