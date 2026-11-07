// The refined finish's motion: quiet (≤ 8px, ≤ 300 ms, no spring), direction-true, and
// STILL under reduced motion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { presets } from "../../motion.ts";
import { REFINED_SIDE_FLAVOR, refinedMotion, type RefinedMotion } from "./motion.ts";

type Init = { x?: number; y?: number; scale?: number };
type Tr = { duration?: number; type?: string };

const specs = (m: RefinedMotion) => [m.answerSwap(1), m.answerSwap(-1), m.panelEnter, m.consentEnter];

test("reduced motion is the still form", () => {
  for (const s of specs(refinedMotion(true))) {
    assert.equal(s.initial, false);
    assert.equal((s.transition as Tr).duration, 0);
  }
});

test("every move is a short ease-out slide: ≤ 8px, ≤ 300 ms, no spring, no scale", () => {
  for (const s of specs(refinedMotion(false))) {
    const i = s.initial as Init;
    assert.ok(Math.abs(i.x ?? 0) <= 8 && Math.abs(i.y ?? 0) <= 8, JSON.stringify(i));
    assert.equal(i.scale, undefined);
    const tr = s.transition as Tr;
    assert.notEqual(tr.type, "spring");
    assert.ok((tr.duration ?? 1) <= 0.3);
  }
});

test("the swap enters from the side the stepper went to", () => {
  const m = refinedMotion(false);
  assert.ok((m.answerSwap(1).initial as Init).x! > 0);
  assert.ok((m.answerSwap(-1).initial as Init).x! < 0);
});

test("the side's flavor tweens the tab pill and staggers rows inside ~300 ms", () => {
  const p = presets(REFINED_SIDE_FLAVOR, false);
  assert.notEqual((p.tabIndicator as Tr).type, "spring");
  const last = p.rowStagger(40)!.transition as { delay: number; duration: number };
  assert.ok(last.delay + last.duration <= 0.3, `${last.delay + last.duration}`);
});
