// A persisted fairness blob is Python-produced JSON, re-parsed UNVALIDATED on every
// modal open (group-eval.ts getGroupEval). The panel indexes labels / candidateIds /
// schemes / matrix[i][j] / mean[i] in lockstep on the strength of a TYPE assertion
// alone, so one misaligned blob threw inside render and unmounted the WHOLE group-eval
// modal — comparison table, inline decide buttons, and the Re-run button that would
// have replaced the bad blob included. These tests pin the alignment guard and the
// honest degradation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assessRobustness, isFairnessAligned } from "@/app/features/shared/groupEvalTypes.ts";
import type { Fairness } from "@/app/features/shared/groupEvalTypes.ts";

const dir = path.dirname(fileURLToPath(import.meta.url));

const good: Fairness = {
  labels: ["Ada", "Bo"],
  candidateIds: ["c1", "c2"],
  schemes: [
    { skills: 0.5, career: 0.3, personal: 0.2 },
    { skills: 0.6, career: 0.2, personal: 0.2 },
  ],
  matrix: [
    [70, 68],
    [65, 66],
  ],
  own: [70, 66],
  mean: [69, 65],
  ranking: ["Ada", "Bo"],
  weightNotes: { c1: ["skills weighted up on high-trust evidence"] },
  weightSource: "deterministic",
};

test("a well-formed matrix is aligned", () => {
  assert.equal(isFairnessAligned(good), true);
});

test("a SHORT schemes array (the persisted-payload regression) is rejected, not indexed off the end", () => {
  // Exactly the shape that crashed: fmtScheme(schemes[j]) on an undefined scheme.
  const shortSchemes = { ...good, schemes: [good.schemes[0]] } as Fairness;
  assert.equal(isFairnessAligned(shortSchemes), false);
  // …and the honest status follows: an unreadable check is not a check.
  assert.equal(assessRobustness(true, shortSchemes), "unavailable");
  assert.notEqual(assessRobustness(true, shortSchemes), "assessed");
});

test("every parallel array must agree with labels in length", () => {
  assert.equal(isFairnessAligned({ ...good, candidateIds: ["c1"] } as Fairness), false);
  assert.equal(isFairnessAligned({ ...good, mean: [69] } as Fairness), false);
  assert.equal(isFairnessAligned({ ...good, matrix: [[70, 68]] } as Fairness), false);
});

test("a ragged matrix ROW (right row count, short row) is rejected", () => {
  assert.equal(isFairnessAligned({ ...good, matrix: [[70, 68], [65]] } as Fairness), false);
});

test("a scheme cell missing its weights is rejected (the header formats all three)", () => {
  const bad = { ...good, schemes: [good.schemes[0], { skills: 0.6, career: 0.2 } as unknown as Fairness["schemes"][number]] } as Fairness;
  assert.equal(isFairnessAligned(bad), false);
});

test("missing / empty blobs stay rejected (unchanged behaviour)", () => {
  assert.equal(isFairnessAligned(null), false);
  assert.equal(isFairnessAligned(undefined), false);
  assert.equal(isFairnessAligned({ ...good, labels: [] } as Fairness), false);
});

test("the panel guards on the alignment check, not on bare non-emptiness", () => {
  // The panel is a client component with no unit seam; pin the wiring in source so the
  // unguarded parallel-array indexing can't come back.
  const src = readFileSync(path.join(dir, "FairnessPanel.tsx"), "utf8");
  assert.match(src, /if \(!isFairnessAligned\(fairness\)\)/, "the render guard must use isFairnessAligned");
  assert.doesNotMatch(src, /!fairness \|\| !fairness\.labels\?\.length/, "the old non-emptiness-only guard must be gone");
});
