// One cohort ranking (challenge-r10 devcase-detail/A).
//
// A case's submissions used to be ordered in four places with four null conventions
// (the orchestrator's `?? 0` + floor, the shortlist's `?? -1`, the compare matrix's
// evaluated-only sort, the interview kit's held-first sort), and none of them read the
// provenance every evaluation bundle carries. A keyless TEMPLATE transfer score (fluency
// pinned at 0.5, confidence 0.2) is a different instrument from a model-graded one, and a
// per-call LLM fallback puts both in one cohort: the server then auto-promoted - a board
// write and an advance letter - on the raw number, and the studio crowned the template
// row "#1". These cases pin the one rule that replaces the four.
//
// Runner: Node's built-in test runner with type stripping - npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { autoPromoteSlate, evaluationCurrency, rankCohort, withheldFromPromotion } from "./devcase-cohort-rank.ts";
import { OUTCOME_WARNING_CODES, isOutcomeWarningCode, outcomeActions } from "./devcase-stage-outcome.ts";

// app/_lib/ -> repo root is two levels up.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...rel: string[]) => readFileSync(path.join(ROOT, ...rel), "utf8");

type Sub = { id: string; transferScore: number | null; evaluation?: unknown };
const graded = (id: string, score: number): Sub => ({ id, transferScore: score, evaluation: { perStepSources: { transfer: "llm" } } });
const template = (id: string, score: number): Sub => ({ id, transferScore: score, evaluation: { perStepSources: { transfer: "deterministic" } } });

test("1. a mixed cohort numbers only the graded tier; the template row is listed, never numbered against it", () => {
  const a = template("a", 85);
  const b = graded("b", 72);
  const c: Sub = { id: "c", transferScore: null };
  const r = rankCohort([a, b, c]);
  assert.equal(r.mixed, true);
  assert.deepEqual(r.ranked.map((s) => s.id), ["b"]);
  assert.deepEqual(r.template.map((s) => s.id), ["a"]);
  assert.deepEqual(r.unscored.map((s) => s.id), ["c"]);
  // Display order: graded (numbered), template (listed), unscored.
  assert.deepEqual(
    r.rows.map((row) => [row.item.id, row.rank]),
    [["b", 1], ["a", null], ["c", null]]
  );
  assert.equal(r.rows[1].currency, "template");
});

test("2. evaluationCurrency: transfer step first, then evaluate, then the envelope; legacy bundles are graded", () => {
  assert.equal(evaluationCurrency({ perStepSources: { transfer: "llm", tooling: "deterministic" }, source: "partial" }), "graded");
  assert.equal(evaluationCurrency({ source: "deterministic" }), "template");
  assert.equal(evaluationCurrency({ perStepSources: { evaluate: "deterministic" }, source: "partial" }), "template");
  assert.equal(evaluationCurrency({ perStepSources: {}, source: "llm" }), "graded");
  // Neither field: a bundle predating provenance is kept (devcase-cohort.ts applies the same rule).
  assert.equal(evaluationCurrency({ evaluation: { summary: "x" } }), "graded");
  assert.equal(evaluationCurrency(null), "graded");
  assert.equal(evaluationCurrency("not an object"), "graded");
});

test("3. a uniform keyless cohort ranks by score, and auto-promote is exactly today's filter/sort/slice", () => {
  const r = rankCohort([template("x", 60), template("y", 40), template("z", 85)]);
  assert.equal(r.mixed, false);
  assert.deepEqual(r.ranked.map((s) => s.transferScore), [85, 60, 40]);
  assert.deepEqual(r.template, []);
  assert.deepEqual(r.rows.map((row) => row.rank), [1, 2, 3]);
  assert.deepEqual(autoPromoteSlate(r, 55, 3).map((s) => s.transferScore), [85, 60]);
  assert.equal(withheldFromPromotion(r, 55), 0);
  // topN still caps.
  assert.deepEqual(autoPromoteSlate(r, 0, 2).map((s) => s.transferScore), [85, 60]);
});

test("3b. a mixed cohort's slate draws from the graded tier; withheld counts template rows that cleared the floor", () => {
  const r = rankCohort([template("t1", 85), graded("g1", 72), template("t2", 30), graded("g2", 50)]);
  assert.deepEqual(autoPromoteSlate(r, 55, 3).map((s) => s.id), ["g1"]);
  assert.equal(withheldFromPromotion(r, 55), 1);
  // A graded-only cohort with a legacy (provenance-less) bundle is still uniform.
  const legacy = rankCohort([graded("g", 70), { id: "l", transferScore: 80, evaluation: { evaluation: {} } }]);
  assert.equal(legacy.mixed, false);
  assert.deepEqual(legacy.ranked.map((s) => s.id), ["l", "g"]);
});

test("3c. equal scores keep their input order (stable), and an accessor ranks wrapped rows", () => {
  const rows = [{ s: graded("p", 70), ch: "x" }, { s: graded("q", 70), ch: "y" }, { s: graded("r", 90), ch: "z" }];
  const r = rankCohort(rows, (row) => row.s);
  assert.deepEqual(r.ranked.map((row) => row.s.id), ["r", "p", "q"]);
});

test("7. mixed_currency is a known warning, explain-only, labelled in all four locales", () => {
  assert.equal(isOutcomeWarningCode("mixed_currency"), true);
  assert.ok((OUTCOME_WARNING_CODES as readonly string[]).includes("mixed_currency"));
  assert.deepEqual(
    outcomeActions({ code: "promoted", facts: {}, warnings: [{ code: "mixed_currency", count: 2 }] }, { caseId: "c1" }),
    [],
    "no one-click fix exists, so no button"
  );
  for (const locale of ["en", "cs", "de", "fr"]) {
    const cat = JSON.parse(read("messages", `${locale}.json`)) as {
      devcase?: { lifecycle?: { outcome?: Record<string, unknown> }; studio?: { shortlist?: Record<string, unknown> } };
    };
    assert.equal(typeof cat.devcase?.lifecycle?.outcome?.mixed_currency, "string", `${locale}: devcase.lifecycle.outcome.mixed_currency`);
    assert.equal(typeof cat.devcase?.studio?.shortlist?.templateTier, "string", `${locale}: devcase.studio.shortlist.templateTier`);
  }
  // The tone map is exhaustive (Record<OutcomeWarningCode, BadgeTone>), so tsc forces it;
  // this pins that the entry exists in source too.
  assert.match(read("app", "features", "tools", "devcases", "DevLifecycleRow.tsx"), /mixed_currency:\s*"caution"/);
});

test("8. source guard: no cohort ordering is hand-written with a `transferScore ??` comparator any more", () => {
  const files = [
    ["app", "_lib", "devcase-orchestrator.ts"],
    ["app", "_lib", "devcase-compare.ts"],
    ["app", "_lib", "devcase-interview-kit.ts"],
    ["app", "features", "tools", "devcases", "DevCaseDetailShortlist.tsx"],
  ];
  for (const rel of files) {
    const src = read(...rel);
    const name = rel.join("/");
    assert.doesNotMatch(src, /transferScore \?\? -1/, `${name} still sorts on \`transferScore ?? -1\``);
    assert.doesNotMatch(src, /transferScore \?\? 0\)/, `${name} still ranks on \`transferScore ?? 0\``);
    assert.match(src, /from "(\.\/|@\/app\/_lib\/)devcase-cohort-rank(\.ts)?"/, `${name} imports the one comparator`);
  }
});
