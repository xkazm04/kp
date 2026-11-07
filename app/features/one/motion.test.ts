// The motion presets: every flavor moves in under ~300 ms, nothing loops, and the reduced
// form is STILL (no offset, no stagger, no tween) — the finishes pick a flavor, never a
// motion the reduced-motion reader would get.
import { test } from "node:test";
import assert from "node:assert/strict";
import { presets, ROW_STAGGER_MAX, type MotionFlavor } from "./motion.ts";

const FLAVORS: MotionFlavor[] = ["calm", "spring", "snap"];

test("reduced motion is the still form for every preset and flavor", () => {
  for (const f of FLAVORS) {
    const p = presets(f, true);
    assert.equal(p.answerSwap(1).initial, false);
    assert.equal(p.answerSwap(-1).initial, false);
    assert.equal(p.panelEnter.initial, false);
    assert.equal(p.consentEnter.initial, false);
    assert.equal(p.rowStagger(0), null);
    assert.equal(p.countTick, 0);
  }
});

test("the swap enters from the side the stepper went to; rows past the cap arrive with the last", () => {
  for (const f of FLAVORS) {
    const p = presets(f, false);
    const fwd = p.answerSwap(1).initial as { x: number };
    const back = p.answerSwap(-1).initial as { x: number };
    assert.ok(fwd.x > 0 && back.x < 0, f);
    const last = p.rowStagger(ROW_STAGGER_MAX - 1)!.transition as { delay: number };
    const past = p.rowStagger(ROW_STAGGER_MAX + 20)!.transition as { delay: number };
    assert.equal(past.delay, last.delay, "no hole: later rows wait for the last staggered one");
    assert.ok(last.delay <= 0.3, "the stagger finishes inside the budget");
    assert.ok(p.countTick > 0 && p.countTick <= 0.35);
    for (const spec of [p.answerSwap(1), p.panelEnter, p.consentEnter]) {
      const tr = spec.transition as { duration?: number; repeat?: number };
      assert.equal(tr.repeat, undefined, "nothing loops");
      if (tr.duration !== undefined) assert.ok(tr.duration <= 0.3, `${f} ${tr.duration}`);
    }
  }
});
