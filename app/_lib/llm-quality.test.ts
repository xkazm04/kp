// The derived half of the Models-tab scorecard: composite → per-op winner →
// per-model overall. The data it reads is BAKED (llm-quality-scores.ts, generated
// by bake_quality.py), so a bug here silently republishes a measured run as a
// different ranking.
//
// The trap pinned below is the tie: two models can land on the same composite,
// and `scores.models` is the bench run's record order, not a ranking — so any
// "first one wins" tie-break lets the run order decide a published number.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bestModelForOp,
  modelOverall,
  modelRanking,
  qualityComposite,
  topModelsForOp,
  type QualityCell,
  type QualityScores,
} from "./llm-quality.ts";
import { QUALITY_SCORES } from "./llm-quality-scores.ts";

const cell = (relevance: number, correctness: number, adherence: number, over: Partial<QualityCell> = {}): QualityCell => ({
  relevance,
  correctness,
  adherence,
  score: correctness,
  valid: true,
  judges: 4,
  llmRate: 1,
  p50Ms: 10_000,
  ...over,
});

/** alpha and omega are a dead heat on op_tied; omega wins op_clear outright. */
const TIED: QualityScores = {
  measuredAt: "2026-01-01T00:00:00.000Z",
  judge: "test",
  limit: 4,
  models: ["alpha", "omega"],
  cells: {
    op_tied: { alpha: cell(9, 9, 9), omega: cell(9, 9, 9) },
    op_clear: { alpha: cell(6, 6, 6), omega: cell(9, 9, 9) },
  },
};

test("a dead heat credits BOTH models, not whichever the run wrote first", () => {
  assert.deepEqual(topModelsForOp(TIED, "op_tied"), ["alpha", "omega"]);
  assert.equal(modelOverall(TIED, "alpha").wins, 1, "alpha ties for top on op_tied");
  assert.equal(modelOverall(TIED, "omega").wins, 2, "omega is top on both");
});

test("the tie credit does not depend on the models array order", () => {
  const flipped: QualityScores = { ...TIED, models: ["omega", "alpha"] };
  assert.equal(modelOverall(flipped, "alpha").wins, modelOverall(TIED, "alpha").wins);
  assert.equal(modelOverall(flipped, "omega").wins, modelOverall(TIED, "omega").wins);
});

test("an outright loss is still a loss (the fix must not credit everyone)", () => {
  assert.equal(topModelsForOp(TIED, "op_clear").length, 1);
  assert.deepEqual(topModelsForOp(TIED, "op_clear"), ["omega"]);
});

test("bestModelForOp still answers with one representative winner", () => {
  assert.equal(bestModelForOp(TIED, "op_tied")?.model, "alpha");
  assert.equal(bestModelForOp(TIED, "op_clear")?.model, "omega");
  assert.equal(bestModelForOp(TIED, "op_missing"), null);
});

test("composite weights correctness 0.40 / adherence 0.35 / relevance 0.25", () => {
  assert.equal(qualityComposite(cell(10, 5, 5)), 6.3); // 0.25*10 + 0.4*5 + 0.35*5
  // A structurally invalid output is coerced to the deterministic fallback in
  // production, so it takes the 0.7 hit even when every dimension reads 9.
  assert.equal(qualityComposite(cell(9, 9, 9, { valid: false })), 6.3);
});

test("the shipped matrix: opus is joint-or-outright top on 12 of the 15 ops", () => {
  // Regression guard on the baked data as rendered. Before ties were credited,
  // opus read 10/15: its dead heats on automation_offer (with gemini-3.6-flash)
  // and devcase_role_design (with claude-sonnet-5) went entirely to whichever of
  // the two the bench run happened to write into `models` first.
  const byModel = Object.fromEntries(modelRanking(QUALITY_SCORES).map((m) => [m.model, m.wins]));
  assert.equal(byModel["claude-opus-5"], 12);
  assert.equal(byModel["claude-sonnet-5"], 3);
  assert.equal(byModel["gemini-3.6-flash"], 1); // its one joint top, kept
  assert.deepEqual(topModelsForOp(QUALITY_SCORES, "devcase_role_design"), ["claude-sonnet-5", "claude-opus-5"]);
  assert.deepEqual(topModelsForOp(QUALITY_SCORES, "automation_offer"), ["gemini-3.6-flash", "claude-opus-5"]);
});
