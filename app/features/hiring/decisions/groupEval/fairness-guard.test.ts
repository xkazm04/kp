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
  assert.equal(isFairnessAligned({ ...good, own: [70] } as Fairness), false);
  assert.equal(isFairnessAligned({ ...good, ranking: ["Ada"] } as Fairness), false);
});

test("a KO-short ranking still aligns when koFailed accounts for the dropped labels", () => {
  // recruiter.fairness_check keeps KO rows in the matrix and drops them from ranking.
  const koShort = { ...good, ranking: ["Ada"], koFailed: ["c2"] };
  assert.equal(isFairnessAligned(koShort as Fairness), true);
  assert.equal(isFairnessAligned({ ...good, ranking: ["Ada"], koFailed: [] } as Fairness), false);
});

test("ranking must name labels from the matrix field", () => {
  assert.equal(isFairnessAligned({ ...good, ranking: ["Ada", "Cyril"] } as Fairness), false);
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
  const src = readFileSync(path.join(dir, "GroupEvalFairnessPanel.tsx"), "utf8");
  assert.match(src, /if \(!isFairnessAligned\(fairness\)\)/, "the render guard must use isFairnessAligned");
  assert.doesNotMatch(src, /!fairness \|\| !fairness\.labels\?\.length/, "the old non-emptiness-only guard must be gone");
});

// ---- Identity, not display name (challenge-r06 tests-scoring-fairness/B) ----------
//
// recruiter.fairness_check now emits `rankingIds` — the robust order as candidate ids,
// KO-failed ids excluded. Two candidates may share a label (namesakes, or every unnamed
// profile's 'Candidate' fallback), so when ids are present the guard validates them;
// a legacy blob without them is judged by the label rule above, unchanged.
const namesakes = {
  labels: ["Jan Novák", "Jan Novák"],
  candidateIds: ["a", "b"],
  schemes: good.schemes,
  matrix: good.matrix,
  own: good.own,
  mean: good.mean,
  ranking: ["Jan Novák"],
  rankingIds: ["a"],
  koFailed: ["b"],
  weightNotes: { a: ["skills weighted up on high-trust evidence"] },
  weightSource: "deterministic",
} as Fairness;

test("a namesake pool with one KO is aligned and assessed (not 'could not assess')", () => {
  assert.equal(isFairnessAligned(namesakes), true);
  assert.equal(assessRobustness(true, namesakes), "assessed");
});

test("rankingIds must name the matrix's own candidates, once each, never a KO-failed one", () => {
  assert.equal(isFairnessAligned({ ...namesakes, rankingIds: ["z"] } as Fairness), false, "unknown id");
  assert.equal(
    isFairnessAligned({ ...namesakes, rankingIds: ["a", "a"], ranking: ["Jan Novák", "Jan Novák"], koFailed: [] } as Fairness),
    false,
    "duplicate id",
  );
  assert.equal(isFairnessAligned({ ...namesakes, rankingIds: ["b"] } as Fairness), false, "id also in koFailed");
  assert.equal(
    isFairnessAligned({ ...namesakes, rankingIds: ["a"], koFailed: [] } as Fairness),
    false,
    "ids + KO must still cover the field",
  );
});

test("rankingIds and its label twin must agree in lockstep", () => {
  const distinct = { ...namesakes, labels: ["Ada", "Bo"], ranking: ["Bo"], rankingIds: ["a"] } as Fairness;
  assert.equal(isFairnessAligned(distinct), false, "ranking[i] must be the label of rankingIds[i]");
});

test("a legacy blob with NO rankingIds is judged by the label rule, unchanged", () => {
  const legacy = { ...good, ranking: ["Ada"], koFailed: ["c2"] };
  assert.equal(isFairnessAligned(legacy as Fairness), true);
  assert.equal(isFairnessAligned({ ...good, ranking: ["Ada"], koFailed: [] } as Fairness), false);
});

test("Fair Rank rows and robust-order pills key on candidate id, never on label", () => {
  const panel = readFileSync(path.join(dir, "GroupEvalFairnessPanel.tsx"), "utf8");
  const audit = readFileSync(
    path.join(dir, "..", "..", "..", "library", "jobs", "JobsRecruiterCandidatesFairness.tsx"),
    "utf8",
  );
  assert.doesNotMatch(audit, /key=\{r\.label\}/, "the audit table must not key rows on the display label");
  assert.match(audit, /key=\{r\.id\}/, "the audit table keys rows on the candidate id");
  assert.doesNotMatch(panel, /key=\{l\}/, "robust-order pills must not key on the label");
  assert.match(panel, /robustOrderEntries\(fairness\)/, "the pills render the id-keyed robust order");
});
