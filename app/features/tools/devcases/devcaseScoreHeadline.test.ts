import test from "node:test";
import assert from "node:assert/strict";

// challenge-r05 devcase-core/B — the eval panel's headline is the rubric-weighted case score,
// and it is by construction the sum of the per-dimension contributions shown beneath it
// (registry: component-sum-is-authoritative). Transfer keeps its own labelled figure. A bundle
// persisted before the composite existed says so instead of displaying weights as if applied.
const { headlineFor } = await import("./devcaseScoreHeadline.ts");

const row = (name: string, weight: number, score: number, contribution?: number | null) => ({
  name,
  label: name,
  weight,
  score,
  description: "",
  ...(contribution === undefined ? {} : { contribution }),
});

const COMPOSITE = {
  overallScore: 65,
  dimensions: [
    row("framing", 0.2, 40, 8),
    row("tooling", 0.25, 90, 22.5),
    row("judgment", 0.25, 90, 22.5),
    row("architecture", 0.15, 40, 6),
    row("transfer", 0.15, 40, 6),
  ],
};

test("a stamped case score is the headline, and the rows sum to it", () => {
  const h = headlineFor(COMPOSITE, { transferScore: 81 });
  assert.equal(h.kind, "composite");
  assert.equal(h.value, 65);
  assert.equal(h.weightsApplied, true);
  const sum = h.rows.reduce((acc, r) => acc + (r.contribution ?? 0), 0);
  assert.equal(Math.round(sum), 65);
  assert.deepEqual(
    h.rows.map((r) => [r.name, r.contribution]),
    [["framing", 8], ["tooling", 22.5], ["judgment", 22.5], ["architecture", 6], ["transfer", 6]],
  );
});

test("transfer is its own labelled figure, never the headline", () => {
  const h = headlineFor(COMPOSITE, { transferScore: 81 });
  assert.equal(h.transfer, 81);
  assert.notEqual(h.value, h.transfer);
  assert.equal(headlineFor(COMPOSITE, undefined).transfer, null);
});

test("a bundle without overallScore is legacy: no value, weights not applied", () => {
  const legacy = { dimensionScores: { framing: 40 }, dimensions: COMPOSITE.dimensions.map((d) => row(d.name, d.weight, d.score)) };
  const h = headlineFor(legacy, { transferScore: 60 });
  assert.equal(h.kind, "legacy");
  assert.equal(h.value, null);
  assert.equal(h.weightsApplied, false);
  assert.equal(h.transfer, 60);
  assert.ok(h.rows.every((r) => r.contribution === null));
  assert.equal(headlineFor(undefined, undefined).kind, "legacy");
});

test("an unscored dimension is marked missing, carries no contribution, and is named", () => {
  const partial = {
    overallScore: 69,
    missingDimensions: ["architecture"],
    scoredWeight: 0.85,
    dimensions: [
      row("framing", 0.2, 40, 9.41),
      row("tooling", 0.25, 90, 26.47),
      row("judgment", 0.25, 90, 26.47),
      row("architecture", 0.15, 50, null),
      row("transfer", 0.15, 40, 7.06),
    ],
  };
  const h = headlineFor(partial, undefined);
  assert.equal(h.kind, "composite");
  assert.deepEqual(h.missing, ["architecture"]);
  assert.equal(h.scoredWeight, 0.85);
  const arch = h.rows.find((r) => r.name === "architecture");
  assert.equal(arch?.missing, true);
  assert.equal(arch?.contribution, null);
  assert.equal(Math.round(h.rows.reduce((a, r) => a + (r.contribution ?? 0), 0)), 69);
});

test("a malformed overallScore is not promoted to a headline", () => {
  for (const bad of [Number.NaN, -3, 140, "65" as unknown as number]) {
    assert.equal(headlineFor({ ...COMPOSITE, overallScore: bad }, undefined).kind, "legacy", String(bad));
  }
});

test("a headline that drifted from its own rows is pinned to their sum", () => {
  const drifted = headlineFor({ ...COMPOSITE, overallScore: 82 }, undefined);
  assert.equal(drifted.kind, "composite");
  assert.equal(drifted.value, 65);
  assert.equal(drifted.kind === "composite" && drifted.recomputed, true);
  const exact = headlineFor(COMPOSITE, undefined);
  assert.equal(exact.kind === "composite" && exact.recomputed, false);
});
