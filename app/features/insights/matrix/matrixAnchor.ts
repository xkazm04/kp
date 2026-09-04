// grid-stays-still-while-you-scroll. The popover's anchor tracker, coalesced to one
// update per animation frame.
//
// The Fit Matrix popover follows its cell: `useMatrixTab` listens for `scroll` in the
// CAPTURE phase (so the grid's own overflow-auto scroller fires it too) plus `resize`,
// and re-anchors from the live trigger rect. Both fire at input rate — a trackpad flick
// over a 200×N grid is dozens of events per frame — and each one used to call
// `setPopover({ ...cur, rect })`. That is a state update on the tab, so the ENTIRE grid
// subtree re-rendered per scroll event: every cell rebuilding its `title` and
// `aria-label` through the translator, for a change no cell can see.
//
// Two fixes, and this module is the first: coalesce to one run per frame, so a burst of
// K events costs exactly one measurement instead of K. The second is that the run no
// longer touches React state at all (see `useMatrixTab`) — it writes `style.top/left` on
// the popover element, which is the only node whose position actually changed.
//
// DOM-free and React-free on purpose: `raf`/`caf` are injected, so a test can drive
// frames deterministically and COUNT the runs.

export type FrameThrottle = {
  /** Request a run on the next frame. Calls within the same frame collapse into one. */
  schedule: () => void;
  /** Drop a pending run (listener teardown / popover close). */
  cancel: () => void;
};

export function createFrameThrottle(
  run: () => void,
  raf: (cb: () => void) => number,
  caf: (handle: number) => void,
): FrameThrottle {
  let pending: number | null = null;
  return {
    schedule: () => {
      if (pending !== null) return; // a frame is already booked — this event rides it
      pending = raf(() => {
        pending = null;
        run();
      });
    },
    cancel: () => {
      if (pending === null) return;
      caf(pending);
      pending = null;
    },
  };
}
