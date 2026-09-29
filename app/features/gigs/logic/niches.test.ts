// Pure logic for niches (niches.ts): specialists folded into niches, and a niche's KPI and
// attempt record (the lanes by gig type are lanes.test.ts).
// Runner: node --test (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { GigKpi } from "@/app/_lib/gigs/types.ts";
import { cell, spec } from "./fixtures.ts";
import { foldNiches, nicheCell, nicheTally, programTally } from "./niches.ts";

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
