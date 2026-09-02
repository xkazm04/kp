// grid-stays-still-while-you-scroll. The measurement for acceptance (b): how many times
// the anchor work runs per scroll burst, before and after.
//
// "Before" is the unthrottled listener the hook had — one run per event, each of which
// was a `setPopover` and therefore a full re-render of the grid subtree. It is modelled
// here as a plain counter so the two numbers sit side by side in one file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFrameThrottle } from "./matrixAnchor.ts";

/** A deterministic requestAnimationFrame: nothing runs until `flush()`. */
function fakeFrames() {
  let next = 1;
  const queued = new Map<number, () => void>();
  return {
    raf: (cb: () => void) => {
      const h = next++;
      queued.set(h, cb);
      return h;
    },
    caf: (h: number) => {
      queued.delete(h);
    },
    flush() {
      const due = [...queued.values()];
      queued.clear();
      due.forEach((cb) => cb());
    },
    get pending() {
      return queued.size;
    },
  };
}

test("a 40-event scroll burst costs ONE anchor run, not 40", () => {
  const frames = fakeFrames();
  let runs = 0;
  const th = createFrameThrottle(() => (runs += 1), frames.raf, frames.caf);

  let unthrottled = 0;
  for (let i = 0; i < 40; i++) {
    unthrottled += 1; // what the old capture-phase listener did: measure + setPopover
    th.schedule();
  }
  assert.equal(runs, 0, "nothing runs before the frame");
  frames.flush();

  assert.equal(unthrottled, 40, "the pre-fix cost: one re-render of the whole grid per event");
  assert.equal(runs, 1, "the post-fix cost: one measurement for the whole burst");
});

test("each new frame gets its own run — tracking is not dropped, only coalesced", () => {
  const frames = fakeFrames();
  let runs = 0;
  const th = createFrameThrottle(() => (runs += 1), frames.raf, frames.caf);
  for (let frame = 0; frame < 5; frame++) {
    th.schedule();
    th.schedule();
    th.schedule();
    frames.flush();
  }
  assert.equal(runs, 5, "the popover still follows its cell every frame it moved");
});

test("cancel drops a pending run, so teardown cannot fire after the popover closed", () => {
  const frames = fakeFrames();
  let runs = 0;
  const th = createFrameThrottle(() => (runs += 1), frames.raf, frames.caf);
  th.schedule();
  assert.equal(frames.pending, 1);
  th.cancel();
  assert.equal(frames.pending, 0, "the frame must be released, not just ignored");
  frames.flush();
  assert.equal(runs, 0);
});

test("cancel is idempotent and re-scheduling after it still works", () => {
  const frames = fakeFrames();
  let runs = 0;
  const th = createFrameThrottle(() => (runs += 1), frames.raf, frames.caf);
  th.cancel();
  th.cancel();
  th.schedule();
  frames.flush();
  assert.equal(runs, 1);
});
