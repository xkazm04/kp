import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCohortClaims, dominates, fitRanks, isDecoyOf, neutralOrder, robustnessOf } from "./cohortClaims.ts";
import { absentCell, tierOf, type ProjectedMember } from "./cohortProject.ts";
import { COHORT_DIMENSIONS, NARRATIVE_TOP, type CohortCell, type CohortDimension, type CohortMember } from "./cohortTypes.ts";

type Ratings = Partial<Record<CohortDimension, number | [rating: number, lo: number, hi: number]>>;

/** A projected member from bare ratings: a number is a rating (default band), a tuple carries its own band. */
function member(id: string, ratings: Ratings, salary: { currency: string; period: string } | null = null): ProjectedMember {
  const cells = {} as Record<CohortDimension, CohortCell>;
  for (const d of COHORT_DIMENSIONS) {
    const r = ratings[d];
    if (r == null) {
      cells[d] = absentCell(d, "notRead");
      continue;
    }
    const [rating, lo, hi] = Array.isArray(r) ? r : [r, null, null];
    cells[d] = { dimension: d, rating, tier: tierOf(rating), label: { key: "x" }, ...(lo != null && hi != null ? { band: { lo, hi, drivers: [] } } : {}) };
  }
  return {
    memberId: id,
    label: id,
    membership: "applicant",
    runState: "done",
    analysisSlug: id,
    roleFamily: null,
    why: Object.fromEntries(COHORT_DIMENSIONS.map((d) => [d, null])) as CohortMember["why"],
    cells,
    detail: {
      fit: null,
      skills: null,
      experience: null,
      signals: null,
      trust: null,
      salary: salary ? { dimension: "salary", currency: salary.currency, period: salary.period, minimum: 1, maximum: 1, midpoint: 1, confidence: null } : null,
      publicWork: null,
    },
  };
}

const claimsOf = (members: ProjectedMember[]) => computeCohortClaims(members, "cohort-x").claims;

// ---- separation ----------------------------------------------------------------------------

test("one rated member is below the floor: no leader, no separation", () => {
  const c = claimsOf([member("a", { fit: [90, 85, 95] }), member("b", {})]);
  assert.deepEqual(c.byDimension.fit, { dimension: "fit", leader: null, separation: "belowFloor", rated: 1 });
  assert.equal(c.overall.leader, null);
  assert.equal(c.overall.separation, "belowFloor");
  assert.equal(c.overall.robustness, "undetermined");
});

test("a leader is named only when its band floor clears the runner-up's ceiling", () => {
  const clears = claimsOf([member("a", { fit: [90, 85, 95] }), member("b", { fit: [70, 65, 75] }), member("c", { fit: [60, 55, 65] })]);
  assert.equal(clears.byDimension.fit.leader, "a");
  assert.equal(clears.byDimension.fit.separation, "clears");
  assert.equal(clears.overall.leader, "a");
  const overlap = claimsOf([member("a", { fit: [80, 75, 85] }), member("b", { fit: [75, 70, 80] })]);
  assert.equal(overlap.byDimension.fit.leader, null);
  assert.equal(overlap.byDimension.fit.separation, "insideNoise");
  assert.equal(overlap.overall.leader, null);
});

test("bands that merely touch overlap: the boundary never resolves in the crown's favour", () => {
  const touch = claimsOf([member("a", { fit: [80, 75, 85] }), member("b", { fit: [70, 65, 75] })]);
  assert.equal(touch.byDimension.fit.separation, "insideNoise");
  assert.equal(touch.byDimension.fit.leader, null);
});

test("a dimension without its own band uses +/-6", () => {
  assert.equal(claimsOf([member("a", { skills: 90 }), member("b", { skills: 77 })]).byDimension.skills.leader, "a"); // 84 > 83
  assert.equal(claimsOf([member("a", { skills: 90 }), member("b", { skills: 78 })]).byDimension.skills.separation, "insideNoise"); // 84 = 84
});

// ---- salary --------------------------------------------------------------------------------

test("salary never names a leader, however wide the gap", () => {
  const c = claimsOf([member("a", { salary: 100 }, { currency: "CZK", period: "month" }), member("b", { salary: 10 }, { currency: "CZK", period: "month" })]);
  assert.equal(c.byDimension.salary.leader, null);
  assert.equal(c.byDimension.salary.separation, "insideNoise");
  assert.equal(c.byDimension.salary.partitions, undefined);
  assert.equal(claimsOf([member("a", { salary: 100 })]).byDimension.salary.separation, "belowFloor");
});

test("salary across currencies or pay bases carries partitions, majority first", () => {
  const c = claimsOf([
    member("a", { salary: 100 }, { currency: "CZK", period: "month" }),
    member("b", { salary: 90 }, { currency: "czk", period: "Month" }),
    member("c", {}, { currency: "EUR", period: "month" }),
    member("d", {}, { currency: "CZK", period: "year" }),
  ]);
  assert.deepEqual(c.byDimension.salary.partitions, [
    { key: "CZK/month", memberIds: ["a", "b"] },
    { key: "CZK/year", memberIds: ["d"] },
    { key: "EUR/month", memberIds: ["c"] },
  ]);
  assert.equal(c.byDimension.salary.rated, 2);
});

// ---- robustness ----------------------------------------------------------------------------

const five = (fit: number, skills: number, rest = 60): Ratings => ({ fit, skills, experience: rest, signals: rest, trust: rest });

test("robustness: stable when the same top holds under every scheme", () => {
  assert.equal(robustnessOf([member("a", five(90, 90)), member("b", five(70, 70)), member("c", five(60, 60))]), "stable");
});

test("robustness: sensitive when the fit-heavy and skills-heavy tops differ", () => {
  // equal: a 65.0 > b 64.0; fit-heavy: a; skills-heavy: a 59.4 < b 75.6 -> the top changes
  assert.equal(robustnessOf([member("a", five(95, 50)), member("b", five(45, 95))]), "sensitive");
  // mirror images tie under the equal scheme: a tie at the top is not a stable top
  assert.equal(robustnessOf([member("a", five(95, 40)), member("b", five(40, 95))]), "sensitive");
});

test("robustness: undetermined below two members rated on all five dimensions", () => {
  assert.equal(robustnessOf([member("a", five(90, 90)), member("b", { fit: 80, skills: 80, experience: 80, signals: 80 })]), "undetermined");
});

// ---- ranks and decoys ----------------------------------------------------------------------

test("fitRank is 1-based, shared on ties, absent for unrated members", () => {
  const ranks = fitRanks([member("a", { fit: 80 }), member("b", { fit: 90 }), member("c", { fit: 80 }), member("d", { fit: 70 }), member("e", {})]);
  assert.deepEqual(Object.fromEntries(ranks), { b: 1, a: 2, c: 2, d: 4 });
});

test("a decoy is a near copy of a contender, dominated by it; the best-ranked such contender is named", () => {
  // default fit bands +/-6: top [84,96], mid [74,86], low [64,76]
  const top = member("top", { fit: 90, skills: 80, experience: 80, trust: 100 });
  const mid = member("mid", { fit: 80, skills: 70, experience: 70, trust: 100 });
  const low = member("low", { fit: 70, skills: 60, experience: 60, trust: 90 });
  const { decoyOf } = computeCohortClaims([low, mid, top], "x");
  assert.equal(decoyOf.get("mid"), "top");
  assert.equal(decoyOf.get("low"), "mid"); // top dominates low too, but is not near it
  assert.equal(decoyOf.has("top"), false);
});

test("condition 1: dominance needs >= 3 shared dimensions, a strict win, and no dimension lost", () => {
  const ranks = new Map([["y", 1]]);
  const near = (r: Ratings) => member("x", r);
  assert.equal(isDecoyOf(member("y", { fit: 82, skills: 90 }), near({ fit: 80, skills: 50, signals: 99 }), ranks), false);
  assert.equal(isDecoyOf(member("y", { fit: 80, skills: 80, trust: 80 }), near({ fit: 80, skills: 80, trust: 80 }), ranks), false);
  assert.equal(isDecoyOf(member("y", { fit: 82, skills: 90, trust: 70 }), near({ fit: 80, skills: 80, trust: 80 }), ranks), false);
  assert.equal(isDecoyOf(member("y", { fit: 82, skills: 90, trust: 90 }), near({ fit: 80, skills: 80, trust: 80 }), ranks), true);
  // salary is not a merit dimension: a better band fit does not rescue a dominated member
  assert.equal(dominates(member("y", { fit: 90, skills: 90, trust: 90, salary: 10 }), member("x", { fit: 80, skills: 80, trust: 80, salary: 100 })), true);
});

test("condition 2: a dominated member whose fit band does not overlap the dominator's is NOT a decoy", () => {
  const allRounder = member("y", { fit: [95, 90, 100], skills: 100, experience: 100, trust: 100 });
  const offProfile = member("x", { fit: [40, 30, 50], skills: 0, experience: 60, trust: 100 });
  assert.equal(dominates(allRounder, offProfile), true);
  assert.equal(isDecoyOf(allRounder, offProfile, new Map([["y", 1]])), false);
  assert.equal(computeCohortClaims([allRounder, offProfile], "x").decoyOf.size, 0);
  // touching bands overlap (inclusive), as they do for separation
  const touching = member("x", { fit: [80, 70, 90], skills: 90, experience: 90, trust: 90 });
  assert.equal(isDecoyOf(allRounder, touching, new Map([["y", 1]])), true);
  // no fit rating on X: no band to be near, so no decoy
  assert.equal(isDecoyOf(allRounder, member("x", { skills: 90, experience: 90, trust: 90 }), new Map([["y", 1]])), false);
});

test("condition 3: the dominator must be a contender, inside the top NARRATIVE_TOP by fit rank", () => {
  const y = member("y", { fit: 60, skills: 80, experience: 80, trust: 100 });
  const x = member("x", { fit: 58, skills: 70, experience: 70, trust: 100 });
  assert.equal(isDecoyOf(y, x, new Map([["y", NARRATIVE_TOP]])), true);
  assert.equal(isDecoyOf(y, x, new Map([["y", NARRATIVE_TOP + 1]])), false);
  assert.equal(isDecoyOf(y, x, new Map()), false);
  // in a real cohort: six members above y push it to rank 7, and x is no longer flagged
  const field = Array.from({ length: NARRATIVE_TOP }, (_, i) => member(`a${i}`, { fit: 90 + i, signals: 40 }));
  assert.equal(computeCohortClaims([...field, y, x], "x").decoyOf.has("x"), false);
  assert.equal(computeCohortClaims([y, x], "x").decoyOf.get("x"), "y");
});

// ---- neutral order -------------------------------------------------------------------------

const ids = Array.from({ length: 20 }, (_, i) => `m${String(i).padStart(2, "0")}`);

test("neutralOrder is deterministic per cohort id and independent of input order", () => {
  const a = neutralOrder("cohort-1", ids);
  assert.deepEqual(neutralOrder("cohort-1", ids), a);
  assert.deepEqual(neutralOrder("cohort-1", [...ids].reverse()), a);
  assert.deepEqual([...a].sort(), ids);
  assert.notDeepEqual(a, ids);
});

test("neutralOrder differs across cohort ids", () => {
  assert.notDeepEqual(neutralOrder("cohort-1", ids), neutralOrder("cohort-2", ids));
});

test("computeCohortClaims records neutralIndex from the neutral order", () => {
  const members = ids.slice(0, 5).map((id) => member(id, { fit: 50 }));
  const { neutralIndex } = computeCohortClaims(members, "cohort-1");
  const order = neutralOrder("cohort-1", ids.slice(0, 5));
  assert.deepEqual(order.map((id) => neutralIndex.get(id)), [0, 1, 2, 3, 4]);
});
