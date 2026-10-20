// The Line-up's street model over the REAL engine fixtures (public/dev/cohort/cohort20.done/running.json) plus synthetic
// claims for the branches the fixtures do not reach (a clearing lead, a cohort below the floor).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { CohortView } from "../../cohortTypes.ts";
import {
  FLOORS, STREET_ROWS, WINDOWS, cellBand, crownOf, floorClaimOf, floorLeaderOf, hazeOf, isStreetOrder, litShare, lotOf,
  salaryLineOf, shadowArc, sharesRank, siteCounts, stepDimension, streetOrder, tourStops,
} from "./lineupModel.ts";

const load = (kind: "done" | "running"): CohortView =>
  JSON.parse(readFileSync(new URL(`../../../../../../../public/dev/cohort/cohort20.${kind}.json`, import.meta.url), "utf8")) as CohortView;
const done = load("done");
const running = load("running");
const byLabel = (v: CohortView, label: string) => v.members.find((m) => m.label === label)!;

test("the rows are the tower then six floors, in the contract's order", () => {
  assert.deepEqual(STREET_ROWS, ["fit", "skills", "experience", "signals", "trust", "salary", "publicWork"]);
  assert.equal(FLOORS.length, 6);
  assert.ok(!FLOORS.includes("fit" as never));
  assert.equal(WINDOWS, 5);
});

test("fit order: ranks first (ties keep the neutral order), unrated members last", () => {
  const street = streetOrder(done.members, "fit");
  assert.equal(street.length, 20);
  assert.equal(street[0].label, "Klára Blažková");
  const ranks = street.map((m) => m.fitRank);
  const firstNull = ranks.indexOf(null);
  assert.ok(firstNull > 0 && ranks.slice(firstNull).every((r) => r === null), "unrated at the end");
  for (let i = 1; i < firstNull; i++) {
    assert.ok((ranks[i] as number) >= (ranks[i - 1] as number));
    if (ranks[i] === ranks[i - 1]) assert.ok(street[i].neutralIndex > street[i - 1].neutralIndex);
  }
  assert.equal(done.members[0].label, "Klára Blažková", "the view is not mutated");
});

test("neutral order is the recorded neutral index and the order toggle is a closed vocabulary", () => {
  assert.deepEqual(streetOrder(done.members, "neutral").map((m) => m.neutralIndex), [...Array(20).keys()]);
  assert.ok(isStreetOrder("fit") && isStreetOrder("neutral") && !isStreetOrder("rank"));
});

test("an absent cell is a lot with its reason (never a zero); pending is under construction", () => {
  const failed = byLabel(done, "Hana Černá");
  assert.deepEqual(lotOf(failed.cells.fit), { kind: "boarded", reason: "failed" });
  assert.equal(litShare(failed.cells.fit), null);
  assert.deepEqual(lotOf(byLabel(done, "Jan Mareš").cells.publicWork), { kind: "boarded", reason: "noLink" });
  assert.deepEqual(lotOf(byLabel(running, "Filip Sýkora").cells.skills), { kind: "building" });
  assert.equal(litShare(byLabel(done, "Karolína Hájková").cells.skills), 0, "a rated zero is lit zero, not boarded");
  assert.deepEqual(lotOf(byLabel(done, "Karolína Hájková").cells.skills), { kind: "rated", rating: 0 });
});

test("bands: the cell's own, else the engine's default half-width, clamped", () => {
  assert.deepEqual(cellBand(byLabel(done, "Klára Blažková").cells.fit), { lo: 88, hi: 100 });
  assert.deepEqual(cellBand(byLabel(done, "Klára Blažková").cells.skills), { lo: 94, hi: 100 });
  assert.equal(cellBand(byLabel(done, "Hana Černá").cells.fit), null);
});

test("inside the noise there is no crown: the top towers share a haze", () => {
  assert.equal(done.claims.overall.separation, "insideNoise");
  assert.equal(crownOf(done), null);
  const haze = hazeOf(done)!;
  assert.deepEqual(haze, { lo: 88, hi: 100, memberIds: ["analysis-cand-000", "analysis-cand-040"] });
});

test("a clearing claim crowns its leader and lifts the haze; below the floor there is neither", () => {
  const clears: CohortView = { ...done, claims: { ...done.claims, overall: { leader: "analysis-cand-000", separation: "clears", robustness: "stable" } } };
  assert.equal(crownOf(clears), "analysis-cand-000");
  assert.equal(hazeOf(clears), null);
  const floor: CohortView = { ...done, claims: { ...done.claims, overall: { leader: null, separation: "belowFloor", robustness: "undetermined" } } };
  assert.equal(crownOf(floor), null);
  assert.equal(hazeOf(floor), null);
});

test("a floor names its leader only when it clears, and salary never", () => {
  assert.equal(floorLeaderOf(done, "publicWork"), "analysis-cand-000");
  assert.equal(floorLeaderOf(done, "skills"), null);
  const salaryClears: CohortView = {
    ...done,
    claims: { ...done.claims, byDimension: { ...done.claims.byDimension, salary: { ...done.claims.byDimension.salary, leader: "x", separation: "clears" } } },
  };
  assert.equal(floorLeaderOf(salaryClears, "salary"), null);
});

test("floor claims: salary split by currency reads as partitioned, never as a lead", () => {
  assert.deepEqual(floorClaimOf(done, "salary"), { tone: "partitioned", leader: null, rated: 16, partitions: 2 });
  assert.deepEqual(floorClaimOf(done, "publicWork"), { tone: "clears", leader: "analysis-cand-000", rated: 3, partitions: 0 });
  assert.equal(floorClaimOf(done, "fit").tone, "insideNoise");
  assert.deepEqual(salaryLineOf(done, "profile:cand-042"), { key: "EUR/month", main: false });
  assert.deepEqual(salaryLineOf(done, "analysis-cand-000"), { key: "CZK/month", main: true });
  assert.equal(salaryLineOf(done, "analysis-cand-004"), null, "quoted nothing");
});

test("the walk-through's stops, shared ranks and the construction line", () => {
  const stops = tourStops(done);
  assert.equal(stops.size, 6);
  assert.equal(stops.get("analysis-cand-000"), 1);
  assert.equal(tourStops(running).size, 0, "no narrative yet");
  assert.ok(sharesRank(done, byLabel(done, "Vít Malý")));
  assert.ok(!sharesRank(done, byLabel(done, "Klára Blažková")));
  assert.deepEqual(siteCounts(done), { built: 18, building: 0, failed: 2 });
  assert.deepEqual(siteCounts(running), { built: 7, building: 12, failed: 1 });
});

test("a decoy's shadow arcs from its dominator's roof; none for a member that is not a decoy", () => {
  const street = streetOrder(done.members, "fit");
  const arc = shadowArc(street, "analysis-cand-047")!;
  const vit = street.findIndex((m) => m.label === "Vít Malý");
  const jan = street.findIndex((m) => m.label === "Jan Mareš");
  assert.deepEqual(arc, { x1: vit + 0.5, y1: 82, x2: jan + 0.5, y2: 74 });
  assert.equal(shadowArc(street, "analysis-cand-000"), null);
});

test("the stairs wrap between the roof and the street", () => {
  assert.equal(stepDimension("fit", 1), "skills");
  assert.equal(stepDimension("fit", -1), "publicWork");
  assert.equal(stepDimension("publicWork", 1), "fit");
});
