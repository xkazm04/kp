// Pins the HONEST progress-strip logic (Direction 3): the strip reflects only the
// phases the TS side can OBSERVE (reading → analyzing → saving), and
//   (a) surfaces the server's REAL per-variant progress for a multi-CV comparison,
//   (b) for a single run, flips to an INDETERMINATE state while the long, opaque
//       "analyzing" (engine) span is active rather than showing a fabricated
//       advancing percentage.
//
// Runner: Node's built-in test runner with type stripping.
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveProgressDisplay,
  headlineStageOf,
  initialStageState,
  applyStageEvent,
  STAGE_ORDER,
  type StageState,
} from "./analysis-progress-logic.ts";

// Build a stage state with `stage` active (earlier stages auto-marked done).
function withActive(stage: (typeof STAGE_ORDER)[number]): StageState {
  return applyStageEvent(initialStageState(), stage, "active");
}

// ── The honest phase set replaced the six cosmetic Python-internal stages ─────
test("the strip has exactly the three observable phases", () => {
  assert.deepEqual(STAGE_ORDER, ["reading", "analyzing", "saving"]);
});

// ── The long engine span → indeterminate (not a frozen percentage) ────────────
test("single run in the analyzing (engine) span is indeterminate", () => {
  const stages = withActive("analyzing"); // reading -> done, analyzing active
  const d = deriveProgressDisplay({ stages, complete: false });
  assert.equal(d.indeterminate, true, "the long engine call must read as in-progress, not a frozen fill");
  assert.equal(d.percent, 33, "reading done → 1/3");
});

// ── The instant saving phase is a determinate near-complete bar ───────────────
test("single run saving is a determinate 2/3 fill", () => {
  const d = deriveProgressDisplay({ stages: withActive("saving"), complete: false });
  assert.equal(d.indeterminate, false);
  assert.equal(d.percent, 67);
});

// ── complete → 100%, determinate ─────────────────────────────────────────────
test("complete run shows a full determinate bar", () => {
  const d = deriveProgressDisplay({ stages: initialStageState(), complete: true });
  assert.deepEqual(d, { percent: 100, indeterminate: false });
});

// ── No stage regression: advancing only completes earlier phases ──────────────
test("applyStageEvent never re-opens an earlier phase (no regression on a late signal)", () => {
  let s = withActive("saving"); // reading+analyzing done, saving active
  // A stray late "analyzing active" (e.g. a duplicated poll) must not rewind.
  s = applyStageEvent(s, "analyzing", "active");
  assert.equal(s.reading, "done");
  assert.equal(s.saving, "active", "saving stays the furthest reached phase");
});

// ── multi-variant drives the bar from REAL per-variant completion ─────────────
test("multi-variant run reflects the server's real done/total, not the phase strip", () => {
  // The phase strip says almost nothing has finished (reading active), but the
  // server reports 2 of 3 variants genuinely complete — the real signal wins.
  const stages = withActive("reading");
  const d = deriveProgressDisplay({ stages, complete: false, variantsDone: 2, variantsTotal: 3 });
  assert.equal(d.percent, 67, "2 of 3 variants -> 67%");
  assert.equal(d.indeterminate, false, "a real determinate count is available");
});

// ── Multi-variant before the first variant lands → indeterminate motion ──────
test("multi-variant with nothing finished yet is indeterminate", () => {
  const d = deriveProgressDisplay({ stages: withActive("analyzing"), complete: false, variantsDone: 0, variantsTotal: 3 });
  assert.equal(d.percent, 0);
  assert.equal(d.indeterminate, true, "no honest determinate value yet → show motion, not a dead 0% bar");
});

// ── A single variant (total 1) keeps the phase-strip semantics ───────────────
test("variantsTotal of 1 falls back to the phase strip (not real-progress mode)", () => {
  const d = deriveProgressDisplay({ stages: withActive("analyzing"), complete: false, variantsDone: 0, variantsTotal: 1 });
  assert.equal(d.indeterminate, true, "a single variant still shows the engine span as indeterminate");
  assert.equal(d.percent, 33);
});

// ── Clamp: a done count over/under total never yields a nonsense percent ──────
test("variant done count is clamped into [0,total]", () => {
  assert.equal(deriveProgressDisplay({ stages: initialStageState(), complete: false, variantsDone: 9, variantsTotal: 3 }).percent, 100);
  assert.equal(deriveProgressDisplay({ stages: initialStageState(), complete: false, variantsDone: -4, variantsTotal: 3 }).percent, 0);
});

// ── headlineStageOf: the panel's <h2> reads from this, so pin every branch ────
// It was the one exported symbol here with no coverage, while driving the single
// biggest piece of text on the card.
test("headlineStageOf names the active phase", () => {
  assert.equal(headlineStageOf(withActive("reading"), false), "reading");
  assert.equal(headlineStageOf(withActive("analyzing"), false), "analyzing");
  assert.equal(headlineStageOf(withActive("saving"), false), "saving");
});

test("headlineStageOf is null before the first phase arrives (surface shows 'starting')", () => {
  assert.equal(headlineStageOf(initialStageState(), false), null);
});

test("headlineStageOf yields to `complete` even while a phase is still active", () => {
  // The completion headline outranks the strip: a late in-flight phase must not
  // pull the card back to "Analyzing" once the run has been finalized.
  assert.equal(headlineStageOf(withActive("analyzing"), true), null);
});

test("headlineStageOf picks the EARLIEST active phase when two are somehow active", () => {
  // Defensive: only one phase should ever be active, but a duplicated poll must
  // resolve deterministically rather than depending on key order.
  const stages: StageState = { reading: "active", analyzing: "active", saving: "pending" };
  assert.equal(headlineStageOf(stages, false), "reading");
});

// ── applyStageEvent's "done" half — the transition finalizeStages relies on ───
test("applyStageEvent marks a phase done and is idempotent on a repeat", () => {
  const once = applyStageEvent(withActive("reading"), "reading", "done");
  assert.equal(once.reading, "done");
  // Same object back on a repeat — the surface's setState(prev => …) must not
  // re-render on a duplicated poll.
  assert.equal(applyStageEvent(once, "reading", "done"), once);
});

test("a repeated 'active' for the phase already active returns the same state", () => {
  const s = withActive("analyzing");
  assert.equal(applyStageEvent(s, "analyzing", "active"), s);
});

test("marking a LATER phase done leaves earlier phases untouched", () => {
  // Only the "active" transition back-fills earlier phases; "done" is a targeted
  // write. Pinned so a future edit to the back-fill rule has to face this.
  const s = applyStageEvent(initialStageState(), "saving", "done");
  assert.equal(s.saving, "done");
  assert.equal(s.reading, "pending");
  assert.equal(s.analyzing, "pending");
});
