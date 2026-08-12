// Pins the candidate-matrix view model — the grouping every matrix variant renders
// from. The invariant that matters most is the last one: no candidate may be
// dropped, whatever their archetype says, because a candidate missing from this
// projection is a candidate nobody will ever look at again.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  archetypeColumns,
  bandOf,
  candidateFacets,
  filterCandidates,
  groupByArchetype,
  hasActiveFilters,
  NO_CANDIDATE_FILTERS,
} from "./candidateMatrixView.ts";
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

test("an archetype nobody routed to is dropped — no lane that can only say 0", () => {
  const cols = archetypeColumns(ARCHETYPES, CANDS);
  assert.equal(groupByArchetype(CANDS, cols).some((g) => g.candidates.length === 0), false);
});

test("every candidate lands in exactly one group — none may be dropped", () => {
  const groups = groupByArchetype(CANDS, archetypeColumns(ARCHETYPES, CANDS));
  const placed = groups.flatMap((g) => g.candidates.map((c) => c.key)).sort();
  assert.deepEqual(placed, CANDS.map((c) => c.key).sort());
});

/* ── Filtering (round 2) ──────────────────────────────────────────────────────
 * Role family, seniority and source moved OFF the candidate card and INTO a
 * filter bar above the view. That trade only pays if the filters actually work,
 * so these pin the predicate the cards no longer print. */

const POOL: CandidateRow[] = [
  { ...C("p1", "Ada Senior", "bau", 90), role: "engineering", seniority: "senior", source: "profile" },
  { ...C("p2", "Bob Junior", "bau", 40), role: "engineering", seniority: "junior" },
  { ...C("p3", "Cleo Lead", "student", 70), role: "design", seniority: "lead" },
  { ...C("p4", "Dee Unknown", "bau", null), role: null, seniority: null },
];

const withFilters = (patch: Partial<typeof NO_CANDIDATE_FILTERS>) => ({ ...NO_CANDIDATE_FILTERS, ...patch });

test("no filters means no filtering — the bar starts inert", () => {
  assert.equal(hasActiveFilters(NO_CANDIDATE_FILTERS), false);
  assert.equal(filterCandidates(POOL, NO_CANDIDATE_FILTERS).length, POOL.length);
  assert.equal(hasActiveFilters(withFilters({ seniority: "senior" })), true);
  // Whitespace is not a filter — a stray space must not narrow the population.
  assert.equal(hasActiveFilters(withFilters({ q: "   " })), false);
});

test("each filter narrows on the facts the card stopped printing, and they compose", () => {
  const ids = (patch: Partial<typeof NO_CANDIDATE_FILTERS>) =>
    filterCandidates(POOL, withFilters(patch)).map((c) => c.key);
  assert.deepEqual(ids({ q: "ada" }), ["p1"], "name search is case-insensitive and substring");
  assert.deepEqual(ids({ seniority: "senior" }), ["p1"]);
  assert.deepEqual(ids({ family: "engineering" }), ["p1", "p2"]);
  assert.deepEqual(ids({ source: "profile" }), ["p1"]);
  assert.deepEqual(ids({ family: "engineering", seniority: "junior" }), ["p2"], "filters compose (AND)");
  assert.deepEqual(ids({ family: "design", seniority: "junior" }), [], "a contradictory pair is empty, not everything");
});

test("a candidate with no role/seniority is hidden by those filters but never by a blank one", () => {
  // "Unknown" must not silently satisfy every filter — that would smuggle
  // unclassified people into a cohort the recruiter thinks they scoped.
  assert.equal(filterCandidates(POOL, withFilters({ seniority: "junior" })).some((c) => c.key === "p4"), false);
  assert.equal(filterCandidates(POOL, withFilters({ family: "engineering" })).some((c) => c.key === "p4"), false);
  assert.equal(filterCandidates(POOL, NO_CANDIDATE_FILTERS).some((c) => c.key === "p4"), true);
});

test("seniority facets keep LADDER order, families are locale-collated", () => {
  const f = candidateFacets(POOL, { locale: "en", label: (g, s) => `${g}:${s}` });
  // junior → lead is a scale; alphabetizing it (junior, lead, senior) would hide that.
  assert.deepEqual(f.seniorities.map((o) => o.value), ["junior", "senior", "lead"]);
  assert.deepEqual(f.families.map((o) => o.value), ["design", "engineering"]);
  // Only what is PRESENT: nobody is `medior`, so it is not offered.
  assert.equal(f.seniorities.some((o) => o.value === "medior"), false);
});

test("an off-ladder seniority is still filterable, sorted after the known levels", () => {
  const odd = [...POOL, { ...C("p5", "Eve Principal", "bau", 60), seniority: "principal", role: null }];
  const f = candidateFacets(odd, { locale: "en", label: (g, s) => `${g}:${s}` });
  assert.deepEqual(f.seniorities.map((o) => o.value), ["junior", "senior", "lead", "principal"]);
  assert.deepEqual(filterCandidates(odd, withFilters({ seniority: "principal" })).map((c) => c.key), ["p5"]);
});

test("filterCandidates never mutates the input array", () => {
  const order = POOL.map((c) => c.key);
  filterCandidates(POOL, withFilters({ seniority: "senior" }));
  assert.deepEqual(POOL.map((c) => c.key), order);
});
