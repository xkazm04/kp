// Spark's finish-local motion: the reduced form is still (the card keeps its tilt as a POSE,
// with no tween), and every move is a non-looping spring that settles quickly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { presets } from "../../motion.ts";
import { CARD_TILT, sparkMotion } from "./motion.ts";

test("reduced motion: every spark move is still; the card rests on its tilt at once", () => {
  const sm = sparkMotion(presets("spring", true));
  assert.equal(sm.answerSwap(1).initial, false);
  assert.equal(sm.answerSwap(-1).initial, false);
  assert.equal(sm.consentEnter.initial, false);
  assert.equal(sm.cardSettle.initial, false);
  assert.deepEqual(sm.cardSettle.transition, { duration: 0 });
  assert.equal(sm.cardSettle.animate.rotate, CARD_TILT);
});

test("full motion: the answer enters from the stepper's side, the card settles onto its tilt", () => {
  const sm = sparkMotion(presets("spring", false));
  const fwd = sm.answerSwap(1).initial;
  const back = sm.answerSwap(-1).initial;
  assert.ok(fwd && back && typeof fwd.x === "number" && typeof back.x === "number");
  assert.ok((fwd.x as number) > 0 && (back.x as number) < 0);
  assert.equal(sm.cardSettle.animate.rotate, CARD_TILT);
  assert.equal(sm.consentEnter.animate.rotate, 0);
});

test("nothing loops and every spring is stiff enough to settle under ~300 ms", () => {
  const sm = sparkMotion(presets("spring", false));
  for (const spec of [sm.answerSwap(1), sm.cardSettle, sm.consentEnter]) {
    const t = spec.transition as { type?: string; stiffness?: number; damping?: number; repeat?: number };
    assert.equal(t.repeat, undefined);
    assert.equal(t.type, "spring");
    assert.ok((t.stiffness ?? 0) >= 400 && (t.damping ?? 0) >= 24);
  }
  assert.ok(Math.abs(CARD_TILT) <= 1);
});
