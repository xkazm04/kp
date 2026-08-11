// Pins the candidate-matrix view model — the grouping every matrix variant renders
// from. The invariant that matters most is the last one: no candidate may be
// dropped, whatever their archetype says, because a candidate missing from this
// projection is a candidate nobody will ever look at again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { archetypeColumns, bandOf, groupByArchetype, largestGroupId } from "./candidateMatrixView.ts";
import type { ArchetypeDef, CandidateRow } from "@/app/features/shared/profileTypes";

const C = (key: string, name: string, archetype: string, score: number | null): CandidateRow => ({
  key,
  source: "analysis",
  slug: key,
  id: key,
  name,
  role: null,
  seniority: null,
  score,
  archetype,
});

const A = (id: string, label: string): ArchetypeDef => ({ id, label }) as ArchetypeDef;
// `bau` and `student` are real registry archetypes; "made-up" is not.
const ARCHETYPES = [A("bau", "Experienced"), A("student", "Student"), A("empty", "Nobody here")];

const CANDS: CandidateRow[] = [
  C("c1", "Strong Bau", "bau", 90),
  C("c2", "Mid Bau", "bau", 60),
  C("c3", "Weak Student", "student", 20),
  C("c4", "Unrouted Person", "made-up", 80),
  C("c5", "Unscored Bau", "bau", null),
];

test("bands use the same 75/50 cutoffs as ScoreBadge, and null is its own band", () => {
  assert.equal(bandOf(CANDS[0]), "strong");
  assert.equal(bandOf(CANDS[1]), "mid");
  assert.equal(bandOf(CANDS[2]), "weak");
  // Not-yet-assessed is NOT a zero — lumping it in with weak would invent a verdict.
  assert.equal(bandOf(CANDS[4]), "unscored");
});

test("an unknown archetype folds into one honest `unrouted` column, never a raw id", () => {
  const cols = archetypeColumns(ARCHETYPES, CANDS);
  assert.ok(cols.some((c) => c.id === "unrouted"), "the made-up archetype becomes unrouted");
  assert.ok(!cols.some((c) => c.id === "made-up"), "the raw unknown id must not become a column");
});

test("an EMPTY retired archetype is pruned, a retired one WITH candidates is kept and flagged", () => {
  // `student` is retired but has c3; `empty` is retired and has nobody.
  const cols = archetypeColumns(ARCHETYPES, CANDS, ["student", "empty"]);
  const student = cols.find((c) => c.id === "student");
  assert.ok(student, "a retired archetype with candidates stays visible");
  assert.equal(student!.archived, true, "and is flagged as retired");
  assert.equal(cols.some((c) => c.id === "empty"), false, "an empty retired column is dead chrome");
});

test("groups sort strongest-first, with name as the tie-break", () => {
  const groups = groupByArchetype(CANDS, archetypeColumns(ARCHETYPES, CANDS));
  const bau = groups.find((g) => g.id === "bau")!;
  assert.deepEqual(bau.candidates.map((c) => c.key), ["c1", "c2", "c5"], "unscored sorts last, not as a 0");
  assert.deepEqual(bau.bands, { strong: 1, mid: 1, weak: 0, unscored: 1 });
});

test("band counts always sum to the group size — the distribution bar cannot lie", () => {
  for (const g of groupByArchetype(CANDS, archetypeColumns(ARCHETYPES, CANDS))) {
    const sum = g.bands.strong + g.bands.mid + g.bands.weak + g.bands.unscored;
    assert.equal(sum, g.candidates.length, `${g.id} bands must account for every candidate`);
  }
});

test("empty groups are dropped by default and kept on request", () => {
  const cols = archetypeColumns(ARCHETYPES, CANDS);
  assert.equal(groupByArchetype(CANDS, cols).some((g) => g.candidates.length === 0), false);
  const withEmpty = groupByArchetype(CANDS, cols, { emptyGroups: true });
  assert.equal(withEmpty.length, cols.length, "the whole taxonomy is available for a coverage read");
});

test("every candidate lands in exactly one group — none may be dropped", () => {
  const groups = groupByArchetype(CANDS, archetypeColumns(ARCHETYPES, CANDS));
  const placed = groups.flatMap((g) => g.candidates.map((c) => c.key)).sort();
  assert.deepEqual(placed, CANDS.map((c) => c.key).sort());
});

test("the opening group is the biggest one, so the first screen is never empty", () => {
  const groups = groupByArchetype(CANDS, archetypeColumns(ARCHETYPES, CANDS));
  assert.equal(largestGroupId(groups), "bau");
  assert.equal(largestGroupId([]), null);
});
