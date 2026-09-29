// Pure logic for niches and lanes (niches.ts, lanes.ts): specialists folded into niches,
// the lane a gig runs in, the lifecycle counts per lane, and the niche's KPI and record.
// Runner: node --test (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { GigKpi } from "@/app/_lib/gigs/types.ts";
import { att, cell, gig, spec } from "./fixtures.ts";
import { laneRows } from "./lanes.ts";
import { foldNiches, laneOfGig, nicheBySpecialistMap, nicheCell, nicheTally, NO_LANE, programTally } from "./niches.ts";

test("foldNiches: one lane per arena + niche (normalized), the working hire leads, earlier copies fold", () => {
  const niches = foldNiches([
    spec("old", "Web Development", "retired", "2026-09-20T00:00:00.000Z"),
    spec("new", "web development ", "active", "2026-09-25T00:00:00.000Z"),
    spec("failed", "web  development", "failed", "2026-09-26T00:00:00.000Z"),
    spec("sec", "web development", "active", "2026-09-21T00:00:00.000Z", "security"),
    spec("py", "python", "active"),
  ]);
  assert.equal(niches.length, 3, "the same niche in another arena is its own lane");
  const web = niches.find((n) => n.key === "freelance|web development")!;
  assert.equal(web.lead.id, "new");
  assert.deepEqual(web.earlier.map((h) => h.id), ["old", "failed"]);
});

test("laneOfGig: the latest attempt's specialist, else the routed one, else the unrouted pool", () => {
  const map = nicheBySpecialistMap(foldNiches([spec("s1", "python", "active"), spec("s2", "writing", "active")]));
  assert.equal(laneOfGig(gig("a", "drafted", { specialistId: "s2" }), att("x", "a", "drafted"), map), "freelance|python");
  assert.equal(laneOfGig(gig("b", "qualified", { specialistId: "s2" }), null, map), "freelance|writing");
  assert.equal(laneOfGig(gig("c", "new"), null, map), NO_LANE);
});

test("laneRows: counts by step, verdicts share a column, exits counted apart, 'none here now' vs 'never reached'", () => {
  const niches = foldNiches([spec("s1", "python", "active")]);
  const map = nicheBySpecialistMap(niches);
  const gigs = [
    gig("a", "drafted", { specialistId: "s1" }),
    gig("b", "accepted", { specialistId: "s1" }),
    gig("c", "declined", { specialistId: "s1" }),
    gig("d", "new"),
  ];
  const [lane, pool] = laneRows(gigs, {}, niches, map);
  const at = (row: typeof lane, step: string) => row.cells.find((c) => c.step === step)!;
  assert.equal(at(lane, "drafted").count, 1);
  assert.equal(at(lane, "verdict").count, 1);
  assert.equal(lane.exit, 1);
  assert.equal(at(lane, "qualified").count, 0);
  assert.equal(at(lane, "qualified").reached, true, "a drafted gig passed qualified: none here NOW");
  assert.equal(at(lane, "suspect").reached, false, "nothing in this lane was ever quarantined");
  assert.equal(pool.key, NO_LANE);
  assert.equal(at(pool, "new").count, 1);
});

test("nicheCell sums the hires' KPI cells and re-derives the rate; unmeasured stays null", () => {
  const n = { hires: [spec("a", "x", "active"), spec("b", "x", "retired")] };
  const kpi = { bySpecialist: { a: cell({ resolved: 2, accepted: 1, pending: 1, costPerAcceptedUsd: 4 }), b: cell({ resolved: 1, accepted: 1, costPerAcceptedUsd: 2 }) } } as unknown as GigKpi;
  const c = nicheCell(n, kpi);
  assert.equal(c.resolved, 3);
  assert.equal(c.accepted, 2);
  assert.equal(c.pending, 1);
  assert.equal(c.rate, 2 / 3);
  assert.equal(c.costPerAcceptedUsd, 3);
  assert.equal(nicheCell(n, null).rate, null, "nothing resolved is unmeasured, never 0%");
  const unknownCost = { bySpecialist: { a: cell({ resolved: 1, accepted: 1, costPerAcceptedUsd: null }) } } as unknown as GigKpi;
  assert.equal(nicheCell(n, unknownCost).costPerAcceptedUsd, null, "an unreported cost is not averaged in as free");
});

test("nicheTally and programTally sum attempt records; unreported cost stays a count", () => {
  const tallies = {
    a: { attempts: 3, byStatus: { failed: 1, drafted: 2 }, costUsd: 1.5, costUnreported: 1 },
    b: { attempts: 1, byStatus: { failed: 1 }, costUsd: 0, costUnreported: 1 },
  };
  assert.deepEqual(nicheTally({ hires: [spec("a", "x", "active"), spec("b", "x", "failed")] }, tallies), { attempts: 4, byStatus: { failed: 2, drafted: 2 }, costUsd: 1.5, costUnreported: 2 });
  assert.equal(programTally(tallies).attempts, 4);
  assert.equal(programTally(null).attempts, 0);
});
