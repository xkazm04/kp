// The Profile tab's candidate population, keyed on CV IDENTITY rather than on store
// rows (challenge-r03 candidate-profile/A).
//
// Before this module the matrix read was a raw union — one row per saved profile plus
// one row per analysis — so one person analysed against four JDs and promoted to a
// profile was FIVE chips, and the analysis chips kept offering "build a profile" for
// a CV that already had one. The join key has always existed on both sides
// (analyses.cv_hash, profiles.source_cv_hash — the content hash of the CV bytes);
// these cases pin that the population folds on it, and ONLY on it: a candidate label
// is a filename-derived display string and is never an identity.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collapsePopulation,
  matrixChipAction,
  type PopulationAnalysis,
  type PopulationProfile,
} from "./candidate-population.ts";

function profile(p: Partial<PopulationProfile> & { id: string }): PopulationProfile {
  return {
    name: "Candidate",
    role: null,
    seniority: null,
    archetype: "unknown",
    sourceCvHash: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...p,
  };
}

function analysis(a: Partial<PopulationAnalysis> & { slug: string }): PopulationAnalysis {
  return {
    name: "Candidate",
    role: null,
    seniority: null,
    archetype: "unknown",
    score: null,
    cvHash: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...a,
  };
}

test("a profile and an analysis of the same CV are ONE row, and the reviewed profile's routing wins", () => {
  const rows = collapsePopulation(
    [profile({ id: "p1", sourceCvHash: "H", archetype: "student" })],
    [analysis({ slug: "a1", cvHash: "H", archetype: "bau", score: 71 })]
  );
  assert.equal(rows.length, 1, "one person, one row");
  const [row] = rows;
  assert.equal(row.source, "profile");
  assert.equal(row.id, "p1");
  assert.equal(row.slug, "a1");
  assert.equal(row.archetype, "student", "the profile was reviewed; the analysis routing is the machine's guess");
  assert.equal(row.analyses.length, 1);
  assert.equal(row.score, 71, "the analysis still supplies the score a profile does not have");
});

test("two analyses of one CV against different JDs fold into one row, newest first, scored by the newest", () => {
  const rows = collapsePopulation(
    [],
    [
      analysis({ slug: "a1", cvHash: "H", score: 60, createdAt: "2026-09-01T10:00:00.000Z" }),
      analysis({ slug: "a2", cvHash: "H", score: 80, createdAt: "2026-09-02T10:00:00.000Z" }),
    ]
  );
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.source, "analysis");
  assert.equal(row.id, null);
  assert.equal(row.score, 80);
  assert.equal(row.slug, "a2", "the chip opens the newest analysis");
  assert.deepEqual(
    row.analyses.map((a) => a.slug),
    ["a2", "a1"],
    "every analysis of the CV is listed, newest first"
  );
});

test("a label is never an identity key: two null-hash analyses with the same label stay two rows", () => {
  const rows = collapsePopulation(
    [],
    [
      analysis({ slug: "a1", cvHash: null, name: "CV.pdf" }),
      analysis({ slug: "a2", cvHash: null, name: "CV.pdf" }),
    ]
  );
  assert.equal(rows.length, 2, "legacy rows saved before cv_hash existed stay unmerged");
  assert.deepEqual(rows.map((r) => r.slug).sort(), ["a1", "a2"]);
});

test("a hand-built profile never absorbs an analysis that merely shares its label", () => {
  const rows = collapsePopulation(
    [profile({ id: "p1", sourceCvHash: null, name: "Jana Novak" })],
    [analysis({ slug: "a1", cvHash: "H", name: "Jana Novak" })]
  );
  assert.equal(rows.length, 2);
  const byId = rows.find((r) => r.id === "p1");
  assert.ok(byId);
  assert.equal(byId.slug, null, "no analysis was attributed to the hand-built profile");
  assert.deepEqual(byId.analyses, []);
  const byAnalysis = rows.find((r) => r.slug === "a1");
  assert.ok(byAnalysis);
  assert.equal(byAnalysis.source, "analysis");
  assert.equal(byAnalysis.id, null);
});

test("the chip's one action edits whenever a profile exists, and builds only for an analysis-only row", () => {
  const [merged] = collapsePopulation(
    [profile({ id: "p1", sourceCvHash: "H" })],
    [analysis({ slug: "a1", cvHash: "H" })]
  );
  assert.deepEqual(matrixChipAction(merged), { kind: "edit", id: "p1" });

  const [analysisOnly] = collapsePopulation([], [analysis({ slug: "a9", cvHash: "Z" })]);
  assert.deepEqual(matrixChipAction(analysisOnly), { kind: "build", slug: "a9" });

  // Never 'build' when an id is present — whatever else the row carries.
  const forged = { ...analysisOnly, id: "p7", source: "analysis" as const };
  assert.deepEqual(matrixChipAction(forged), { kind: "edit", id: "p7" });
});
