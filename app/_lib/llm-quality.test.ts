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
  NOISE_BAND,
  qualityComposite,
  recommendForUseCase,
  RELIABILITY_FLOOR,
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

// ── Challenge r07 llm-layer/B: price each pick, pin the cheapest within noise ──
// The noise band was FIXED before these cases were written (builds/llm-layer--B.json):
// 0.15 composite points when both compared aggregates rest on >= 4 judged scenarios
// per op, 0.30 below; reliability floor 0.9. The cases below assert it, never tune it.

test("the noise band and reliability floor are the numbers fixed before the build", () => {
  assert.deepEqual(NOISE_BAND, { atJudges: 4, narrow: 0.15, wide: 0.3 });
  assert.equal(RELIABILITY_FLOOR, 0.9);
});

test("the shipped bake is priced and names a bench target for every model", () => {
  for (const model of QUALITY_SCORES.models) {
    const target = QUALITY_SCORES.targets?.[model];
    assert.ok(target, `no target for ${model}`);
    assert.equal(target.model, model);
  }
  assert.equal(QUALITY_SCORES.targets?.["claude-opus-5"]?.provider, "claude_cli");
  assert.equal(QUALITY_SCORES.targets?.["gemini-3.6-flash"]?.provider, "gemini");
  // every cell carries the field (a number, or null when unpriced - never absent)
  for (const [op, row] of Object.entries(QUALITY_SCORES.cells)) {
    for (const [model, c] of Object.entries(row)) {
      assert.ok("costPerTaskUsd" in c, `${op}/${model} has no costPerTaskUsd`);
    }
  }
});

test("match_reasoning: gemini-3.6-flash, because opus's 0.1 lead is inside the band at judges=4", () => {
  const rec = recommendForUseCase(QUALITY_SCORES, "match_reasoning");
  assert.ok(rec);
  assert.equal(rec.pick.model, "gemini-3.6-flash");
  assert.equal(rec.pick.composite, 9.0);
  assert.equal(rec.best.model, "claude-opus-5");
  assert.equal(rec.best.composite, 9.1);
  assert.equal(rec.band, 0.15);
  assert.equal(rec.reason, "cheapest_in_band");
  assert.ok(rec.costMultiple !== null && rec.costMultiple >= 50, `costMultiple ${rec.costMultiple}`);
  assert.deepEqual(rec.pick.target, { provider: "gemini", model: "gemini-3.6-flash" });
});

test("jd_ingest: the best is also the cheapest; weight_proposal: a 0.7 gap is out of band", () => {
  const jd = recommendForUseCase(QUALITY_SCORES, "jd_ingest");
  assert.equal(jd?.pick.model, "deepseek-v4-flash");
  assert.equal(jd?.reason, "best_is_cheapest");
  const wp = recommendForUseCase(QUALITY_SCORES, "weight_proposal");
  assert.equal(wp?.pick.model, "claude-opus-5");
  assert.equal(wp?.pick.composite, 8.8);
  // sonnet (8.2) sits under the 0.9 reliability floor at llmRate 0.75, so it is
  // never a candidate; deepseek (8.1) is outside the band.
  assert.equal(wp?.best.model, "claude-opus-5");
  assert.equal(wp?.reason, "best_is_cheapest");
});

test("no cost anywhere -> cost_unmeasured and the top composite; no bench op -> null", () => {
  const rec = recommendForUseCase(TIED, "op_clear_uc", { op_clear: "op_clear_uc" });
  assert.equal(rec?.reason, "cost_unmeasured");
  assert.equal(rec?.pick.model, "omega");
  assert.equal(rec?.costMultiple, null);
  assert.equal(recommendForUseCase(QUALITY_SCORES, "repo_scan"), null);
});

test("the band widens to 0.30 when a compared cell rests on fewer than 4 judges", () => {
  const scores: QualityScores = {
    ...TIED,
    models: ["best", "cheap"],
    cells: {
      op_x: {
        best: cell(9, 9, 9, { costPerTaskUsd: 0.2 }),
        cheap: cell(8.75, 8.75, 8.75, { judges: 3, costPerTaskUsd: 0.001 }),
      },
    },
  };
  const rec = recommendForUseCase(scores, "uc", { op_x: "uc" });
  assert.equal(rec?.band, 0.3);
  assert.equal(rec?.pick.model, "cheap");
  const narrow = recommendForUseCase(
    { ...scores, cells: { op_x: { ...scores.cells.op_x, cheap: { ...scores.cells.op_x.cheap, judges: 4 } } } },
    "uc",
    { op_x: "uc" }
  );
  assert.equal(narrow?.band, 0.15);
  assert.equal(narrow?.pick.model, "best", "a 0.2 gap at judges=4 is a real lead");
});

test("an unpriced cell is never claimed cheapest", () => {
  const scores: QualityScores = {
    ...TIED,
    models: ["priced", "unpriced"],
    cells: {
      op_x: {
        priced: cell(9, 9, 9, { costPerTaskUsd: 0.05 }),
        unpriced: cell(9, 9, 9, { costPerTaskUsd: null }),
      },
    },
  };
  const rec = recommendForUseCase(scores, "uc", { op_x: "uc" });
  assert.equal(rec?.pick.model, "priced");
  assert.notEqual(rec?.reason, "cheapest_in_band");
});
