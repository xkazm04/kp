// The motion presets: every flavor moves in under ~300 ms and nothing loops; reduced motion is
// honoured ONCE (the root MotionConfig, reducedMotion "user"), so the presets keep one form
// and only the JS-driven count tween reads `reduced` itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cascadeDelay, motionConfig, presets, ROW_STAGGER_MAX, type MotionFlavor } from "./motion.ts";

const FLAVORS: MotionFlavor[] = ["calm", "spring", "snap"];

test("reduced motion lives in the root MotionConfig; the count tween still checks it", () => {
  for (const f of FLAVORS) {
    assert.equal(motionConfig(f).reducedMotion, "user");
    assert.equal(presets(f, true).countTick, 0);
    assert.ok(presets(f, false).countTick > 0 && presets(f, false).countTick <= 0.35);
  }
});

test("presets are built once: the same objects every render", () => {
  assert.equal(presets("snap", false), presets("snap", false));
  assert.equal(presets("snap", false).answerSwap(1), presets("snap", false).answerSwap(1));
  assert.equal(presets("snap", false).row, presets("snap", false).row);
});

test("the swap enters from the side the stepper went to; the cascade is capped and inside the budget", () => {
  for (const f of FLAVORS) {
    const p = presets(f, false);
    const fwd = p.answerSwap(1).initial as { x: number };
    const back = p.answerSwap(-1).initial as { x: number };
    assert.ok(fwd.x > 0 && back.x < 0, f);
    const last = cascadeDelay(f, ROW_STAGGER_MAX - 1);
    assert.equal(cascadeDelay(f, ROW_STAGGER_MAX + 20), last, "no hole: later rows wait for the last staggered one");
    const rowDur = ((p.row.shown as { transition?: { duration?: number } }).transition?.duration ?? 0.2);
    assert.ok(last + rowDur <= 0.3, `${f}: the whole cascade lands inside 300 ms`);
    for (const spec of [p.answerSwap(1), p.panelEnter, p.viewSwap, p.consentEnter]) {
      const tr = spec.transition as { duration?: number; repeat?: number };
      assert.equal(tr.repeat, undefined, "nothing loops");
      if (tr.duration !== undefined) assert.ok(tr.duration <= 0.3, `${f} ${tr.duration}`);
    }
  }
});
