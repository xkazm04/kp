// Pins the honest progress-bar logic (bug-ui-scan-2026-07-09 #5): the bar must
// (a) surface the server's REAL per-variant progress for a multi-CV comparison
// instead of the faked stage timeline, and (b) for a single run, flip to an
// indeterminate state once the last (long, un-instrumented) stage is active
// rather than freezing at a fabricated ~83%.
//
// Runner: Node's built-in test runner with type stripping.
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveProgressDisplay,
  initialStageState,
  applyStageEvent,
  STAGE_ORDER,
  type StageState,
} from "./analysis-progress-logic.ts";

// The EXACT pre-fix formula the .tsx used: percent from stage-completion, always
// determinate, variant progress ignored. Kept as the non-vacuity baseline.
function naive(stages: StageState, complete: boolean): { percent: number; indeterminate: boolean } {
  const completedCount = STAGE_ORDER.filter((id) => stages[id] === "done").length;
  const percent = complete ? 100 : Math.round((completedCount / STAGE_ORDER.length) * 100);
  return { percent, indeterminate: false };
}

// Build a stage state with `stage` active (earlier stages auto-marked done).
function withActive(stage: (typeof STAGE_ORDER)[number]): StageState {
  return applyStageEvent(initialStageState(), stage, "active");
}

// ── #5a: the frozen-83% hang → indeterminate on the last stage ───────────────
test("single run with the last stage active is indeterminate (not a frozen 83%)", () => {
  const stages = withActive("insights"); // the final stage; earlier five -> done
  const d = deriveProgressDisplay({ stages, complete: false });
  assert.equal(d.indeterminate, true, "the long final Gemini call must read as in-progress, not stalled");
  // Non-vacuity: pre-fix this same state was a static determinate 83%.
  const pre = naive(stages, false);
  assert.equal(pre.percent, 83, "pre-fix froze here at a fabricated 83%");
  assert.equal(pre.indeterminate, false, "pre-fix had no indeterminate concept");
});

// ── A mid-pipeline active stage stays determinate (honest partial fill) ───────
test("single run mid-pipeline is a determinate partial bar", () => {
  const stages = withActive("profile"); // extract+gemini done -> 2/6
  const d = deriveProgressDisplay({ stages, complete: false });
  assert.equal(d.indeterminate, false);
  assert.equal(d.percent, 33);
});

// ── complete → 100%, determinate ─────────────────────────────────────────────
test("complete run shows a full determinate bar", () => {
  const d = deriveProgressDisplay({ stages: initialStageState(), complete: true });
  assert.deepEqual(d, { percent: 100, indeterminate: false });
});

// ── #5b: multi-variant drives the bar from REAL per-variant completion ────────
test("multi-variant run reflects the server's real done/total, not the stage strip", () => {
  // Stages say almost nothing has finished (only 'extract' active), but the server
  // reports 2 of 3 variants genuinely complete — the real signal must win.
  const stages = withActive("extract");
  const d = deriveProgressDisplay({ stages, complete: false, variantsDone: 2, variantsTotal: 3 });
  assert.equal(d.percent, 67, "2 of 3 variants -> 67%");
  assert.equal(d.indeterminate, false, "a real determinate count is available");
  // Non-vacuity: pre-fix ignored variantsDone/Total and read the stage strip.
  assert.equal(naive(stages, false).percent, 0, "pre-fix showed 0% (only 'extract' active) — discarding the real 2/3");
});

// ── Multi-variant before the first variant lands → indeterminate motion ──────
test("multi-variant with nothing finished yet is indeterminate", () => {
  const d = deriveProgressDisplay({ stages: withActive("extract"), complete: false, variantsDone: 0, variantsTotal: 3 });
  assert.equal(d.percent, 0);
  assert.equal(d.indeterminate, true, "no honest determinate value yet → show motion, not a dead 0% bar");
});

// ── A single variant (total 1) keeps the stage-strip semantics ───────────────
test("variantsTotal of 1 falls back to the stage strip (not real-progress mode)", () => {
  const stages = withActive("scoring"); // 3/6 done
  const d = deriveProgressDisplay({ stages, complete: false, variantsDone: 0, variantsTotal: 1 });
  assert.equal(d.percent, 50, "a single variant uses the cosmetic stage percent");
  assert.equal(d.indeterminate, false);
});

// ── Clamp: a done count over/under total never yields a nonsense percent ──────
test("variant done count is clamped into [0,total]", () => {
  assert.equal(deriveProgressDisplay({ stages: initialStageState(), complete: false, variantsDone: 9, variantsTotal: 3 }).percent, 100);
  assert.equal(deriveProgressDisplay({ stages: initialStageState(), complete: false, variantsDone: -4, variantsTotal: 3 }).percent, 0);
});
