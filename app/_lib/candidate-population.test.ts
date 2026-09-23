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
  analysisFromRecord,
  collapsePopulation,
  matrixChipAction,
  profileFromRecord,
  routedCount,
  withoutProfile,
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

// ── One population for every projection (challenge-r05 profile-roster-matrix/A) ──
//
// The Profile tab served three reads — the roster read saved profiles, the matrix read
// this fold, and the retire dialog re-read the whole roster to count one archetype — so
// the projections disagreed about staleness, family and the retire count. The fold now
// carries what the roster needs (completeness, staleness), and the retire count and the
// delete prune are derived from the same rows.

test("a profile row carries its completeness and its staleness; an analysis-only row carries neither", () => {
  const rows = collapsePopulation(
    [profile({ id: "p1", completeness: 0.6 })],
    [analysis({ slug: "a9", cvHash: "Z" })],
    { p1: { newerSlug: "a2", newerAnalyzedAt: "2026-09-02" } }
  );
  const p = rows.find((r) => r.id === "p1");
  assert.ok(p);
  assert.equal(p.completeness, 0.6);
  assert.deepEqual(p.stale, { newerSlug: "a2", newerAnalyzedAt: "2026-09-02" });
  const a = rows.find((r) => r.source === "analysis");
  assert.ok(a);
  assert.equal(a.completeness, null);
  assert.equal(a.stale, null);
});

test("a profile with no staleness entry reads current (stale null), and a missing completeness is null, never 0", () => {
  const [row] = collapsePopulation([profile({ id: "p1" })], [], { other: { newerSlug: "x", newerAnalyzedAt: "2026-01-01" } });
  assert.equal(row.stale, null);
  assert.equal(row.completeness, null);
});

test("family resolves ONCE, on the server mapping: a null role_family column falls back to the payload's roleFamily", () => {
  const p = profileFromRecord({
    row: { id: "p1", label: "Jana", archetype: null, role_family: null, completeness: 0.5, created_at: "2026-09-01" },
    payload: { roleFamily: "engineering", seniority: "senior" },
    sourceCvHash: null,
  });
  assert.equal(p.role, "engineering");
  assert.equal(p.seniority, "senior");
  assert.equal(p.archetype, "unknown", "an unrouted profile is the fail-closed sentinel, never 'bau'");
  assert.equal(p.completeness, 0.5);
  const [row] = collapsePopulation([p], []);
  assert.equal(row.role, "engineering");
});

test("analysisFromRecord keeps the fail-closed archetype sentinel and the CV hash", () => {
  const a = analysisFromRecord({
    row: { slug: "a1", candidate_label: "CV.pdf", role_family: "design", seniority: null, score: 70, cv_hash: "H", created_at: "2026-09-01" },
    payload: {},
  });
  assert.equal(a.archetype, "unknown");
  assert.equal(a.cvHash, "H");
  const b = analysisFromRecord({
    row: { slug: "a2", candidate_label: "CV.pdf", role_family: null, seniority: null, score: null, created_at: "2026-09-01" },
    payload: { v2Profile: { archetype: "student" } },
  });
  assert.equal(b.archetype, "student");
  assert.equal(b.cvHash, null);
});

test("routedCount counts BOTH stores in the lane being retired, and an unrouted row never counts toward a real archetype", () => {
  const rows = collapsePopulation(
    [
      profile({ id: "p1", archetype: "returner" }),
      profile({ id: "p2", archetype: "returner" }),
      profile({ id: "p3", archetype: "bau" }),
      profile({ id: "p4", archetype: "unknown" }),
    ],
    [
      analysis({ slug: "a1", cvHash: "H1", archetype: "returner" }),
      analysis({ slug: "a2", cvHash: "H2", archetype: "returner" }),
      analysis({ slug: "a3", cvHash: null, archetype: "returner" }),
      analysis({ slug: "a4", cvHash: "H4", archetype: "unknown" }),
    ]
  );
  assert.deepEqual(routedCount(rows, "returner"), { profiles: 2, analyses: 3 });
  assert.deepEqual(routedCount(rows, "bau"), { profiles: 1, analyses: 0 });
  // The sentinel is not an archetype anyone can retire, and "unrouted" is its display
  // name: neither may collect the unclassified rows as if they were routed.
  assert.deepEqual(routedCount(rows, "unknown"), { profiles: 0, analyses: 0 });
  assert.deepEqual(routedCount(rows, "unrouted"), { profiles: 0, analyses: 0 });
  assert.deepEqual(routedCount(rows, ""), { profiles: 0, analyses: 0 });
});

test("routedCount counts a workspace's own custom archetype (the only kind that can be retired), case-insensitively", () => {
  const rows = collapsePopulation([profile({ id: "p1", archetype: "Returner" })], [analysis({ slug: "a1", archetype: "returner " })]);
  assert.deepEqual(routedCount(rows, "returner"), { profiles: 1, analyses: 1 });
});

test("withoutProfile drops exactly the deleted profile's row, and returns the SAME array for an unknown id", () => {
  const rows = collapsePopulation(
    [profile({ id: "p1" }), profile({ id: "p2" })],
    [analysis({ slug: "a1", cvHash: "Z" })]
  );
  const next = withoutProfile(rows, "p1");
  assert.deepEqual(next.map((r) => r.key), ["profile:p2", "analysis:a1"]);
  assert.equal(rows.length, 3, "the input is never mutated");
  assert.equal(withoutProfile(rows, "nope"), rows, "a delete of an unknown id re-renders nothing");
  assert.equal(withoutProfile(rows, "a1"), rows, "an analysis slug is not a profile id");
});
