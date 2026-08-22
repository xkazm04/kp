// Pure-function tests for the Agent fit tab model: verdict/coverage skins, the
// null-safe spec form, the dispatch-overrides builder, and the status timeline.
// Runner: node --test (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  budgetFromInput,
  buildOverrides,
  coverageSkin,
  fitOf,
  isFallbackSource,
  specFormFromRecord,
  timeline,
  toggleConnector,
  toFitVerdict,
  VERDICT_SKIN,
} from "./jobsAgentFitModel.ts";

test("toFitVerdict coerces anything off-taxonomy to unassessed", () => {
  assert.equal(toFitVerdict("complete"), "complete");
  assert.equal(toFitVerdict("temporary"), "temporary");
  for (const bad of ["Complete", "partial", "", null, undefined, 3]) {
    assert.equal(toFitVerdict(bad), "unassessed", `${String(bad)} must coerce to unassessed`);
  }
});

test("verdict skins follow the shared ✓/–/✗ glyph + score-* convention", () => {
  assert.equal(VERDICT_SKIN.complete.glyph, "✓");
  assert.equal(VERDICT_SKIN.complete.bar, "border-l-score-strong");
  // unassessed rides the honest null tone — never a fabricated band.
  assert.equal(VERDICT_SKIN.unassessed.glyph, "–");
  assert.equal(VERDICT_SKIN.unassessed.text, "text-score-null");
  assert.equal(coverageSkin("automatable").glyph, "✓");
  assert.equal(coverageSkin("assisted").glyph, "△");
  assert.equal(coverageSkin("human_only").glyph, "✗");
  assert.equal(coverageSkin("wat").glyph, "–");
});

test("fitOf narrows a malformed fit blob without throwing", () => {
  const fit = fitOf({
    verdict: "temporary",
    coverageRatio: 0.62,
    coverage: [{ item: "Triage", coverage: "automatable", rationale: "r" }, { coverage: "assisted" }, null, "x"],
  });
  assert.equal(fit.verdict, "temporary");
  assert.equal(fit.coverageRatio, 0.62);
  assert.equal(fit.coverage.length, 1); // item-less / non-object rows are dropped
  assert.deepEqual(fitOf(null), { verdict: "unassessed", coverage: [], coverageRatio: null });
});

test("specFormFromRecord is null-safe against a partial spec and a band-less budget", () => {
  const form = specFormFromRecord({ spec: null, budget: { suggestedMonthlyUsd: null } });
  assert.deepEqual(form, { name: "", mission: "", connectors: [], budget: "" });
  const full = specFormFromRecord({
    spec: { name: "Triage agent", mission: "m", connectors: ["gmail", "", 3, "slack"] },
    budget: { suggestedMonthlyUsd: 120 },
  });
  assert.deepEqual(full.connectors, ["gmail", "slack"]);
  assert.equal(full.budget, "120");
});

test("toggleConnector removes present names and re-appends absent ones", () => {
  assert.deepEqual(toggleConnector(["gmail", "slack"], "gmail"), ["slack"]);
  assert.deepEqual(toggleConnector(["slack"], "jira"), ["slack", "jira"]);
});

test("budgetFromInput: empty = no cap, junk = invalid, comma decimals accepted", () => {
  assert.deepEqual(budgetFromInput("  "), { value: null, invalid: false });
  assert.deepEqual(budgetFromInput("120"), { value: 120, invalid: false });
  assert.deepEqual(budgetFromInput("99,5"), { value: 99.5, invalid: false });
  assert.deepEqual(budgetFromInput("-3"), { value: null, invalid: true });
  assert.deepEqual(budgetFromInput("abc"), { value: null, invalid: true });
});

test("budgetFromInput: a grouped-looking thousands value is refused, never read as a decimal", () => {
  // The bug this guards: the comma-decimal support ("99,5" -> 99.5) also swallowed a
  // GROUP separator. Typing "2,000" into the Monthly budget (USD) field returned
  // { value: 2, invalid: false }, so buildOverrides POSTed budgetUsd: 2 and the agent
  // was dispatched with a $2/month cap instead of $2,000 — with no validation shown.
  // "2,000" is 2000 in en and 2.0 in cs, so it is refused, not guessed.
  assert.deepEqual(budgetFromInput("2,000"), { value: null, invalid: true });
  assert.deepEqual(budgetFromInput("12,500"), { value: null, invalid: true });
  assert.deepEqual(budgetFromInput("1.000"), { value: null, invalid: true });
  // And nothing that ISN'T grouping-shaped is refused: the decimal comma still
  // parses, and a plain 4-digit value (with or without decimals) is untouched.
  assert.deepEqual(budgetFromInput("99,5"), { value: 99.5, invalid: false });
  assert.deepEqual(budgetFromInput("2000"), { value: 2000, invalid: false });
  assert.deepEqual(budgetFromInput("1234.56"), { value: 1234.56, invalid: false });
});

test("buildOverrides carries exactly the fields the dispatch route honors", () => {
  const overrides = buildOverrides({ name: " A ", mission: " m ", connectors: ["gmail"], budget: "50" });
  assert.deepEqual(overrides, { name: "A", mission: "m", connectors: ["gmail"], budgetUsd: 50 });
  // No budget → the key is OMITTED so the server falls back to the suggestion.
  assert.equal("budgetUsd" in buildOverrides({ name: "", mission: "", connectors: [], budget: "" }), false);
});

test("timeline walks the ladder for live statuses", () => {
  const t = timeline("onboarding");
  assert.equal(t.terminal, null);
  assert.deepEqual(
    t.steps.map((s) => s.state),
    ["done", "done", "current", "upcoming"]
  );
});

test("timeline marks how far each terminal status got", () => {
  // A failed dispatch never left step 0; a rejection died at the approval gate;
  // a retired agent had been fully active.
  assert.deepEqual(timeline("failed").steps.map((s) => s.state), ["done", "upcoming", "upcoming", "upcoming"]);
  assert.equal(timeline("failed").terminal, "failed");
  assert.deepEqual(timeline("rejected").steps.map((s) => s.state), ["done", "done", "upcoming", "upcoming"]);
  assert.deepEqual(timeline("retired").steps.map((s) => s.state), ["done", "done", "done", "done"]);
});

test("isFallbackSource treats anything but the explicit llm source as heuristic", () => {
  assert.equal(isFallbackSource("llm"), false);
  assert.equal(isFallbackSource("deterministic"), true);
  assert.equal(isFallbackSource(null), true);
  assert.equal(isFallbackSource("LLM "), false);
});
