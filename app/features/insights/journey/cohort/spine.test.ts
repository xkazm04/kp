// The Spine engine and the hiring adapter: the standard path is derived, every journey is
// filed once, a rejection is a decision and not a failure, and a hold is friction on the
// stage it happened in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSpine, type SpineInstance } from "./spine.ts";
import { hiringFailure, hiringInstances } from "./hiringAdapter.ts";
import type { JourneyCohort, JourneyCohortOutcome } from "../../../../_lib/journey/types.ts";

const inst = (id: string, kinds: string[], outcome: string, err: number[] = []): SpineInstance => ({
  id,
  group: "a",
  outcome,
  steps: kinds.map((k, i) => ({ k, t: i * 10, err: err.includes(i) ? 1 : 0, friction: false })),
});
const fails = (o: string) => o === "errored" || o === "interrupted";
const cohort: SpineInstance[] = [
  ...Array.from({ length: 6 }, (_, i) => inst(`ok${i}`, ["brief", "explore", "edit", "verify", "ship"], "landed")),
  inst("noverify1", ["brief", "explore", "edit", "ship"], "landed"),
  inst("quit1", ["brief", "explore"], "errored"),
  inst("quit2", ["brief", "explore"], "interrupted"),
  inst("readonly", ["brief", "explore"], "quiet"),
  inst("broke", ["brief", "explore", "edit", "verify"], "errored", [3]),
];

test("the path is the most-travelled chain", () => {
  const m = buildSpine(cohort, fails);
  assert.deepEqual(m.stations.map((s) => s.keys.join("/")), ["brief", "explore", "edit", "verify", "ship"]);
});

test("coverage, skips and failed endings per station, each instance filed once", () => {
  const m = buildSpine(cohort, fails);
  const [brief, explore, edit, verify, ship] = m.stations;
  assert.equal(brief?.reached, 11);
  assert.equal(explore?.exits, 2, "the clean read-only ending is not a failure");
  assert.equal(edit?.reached, 8);
  assert.equal(verify?.skipped, 1);
  assert.equal(verify?.friction, 1);
  assert.equal(ship?.reached, 7);
  assert.equal(m.stations.reduce((a, s) => a + s.exits, 0), 3);
  assert.equal(m.worst[0], 1);
});

test("a group is measured on the cohort's path", () => {
  const m = buildSpine(cohort.filter((x) => x.id.startsWith("quit")), fails, cohort);
  assert.equal(m.stations.length, 5);
  assert.equal(m.stations[2]?.reached, 0);
});

test("hiring: stages, not event kinds; rejection is a decision; a hold is screen friction", () => {
  const at = (d: number) => new Date(Date.UTC(2026, 6, 1 + d)).toISOString();
  const journey = (id: string, kinds: string[], outcome: JourneyCohortOutcome) => ({
    id, jobId: "job-1", outcome, steps: kinds.map((kind, i) => ({ kind, at: at(i), actor: null })),
  });
  const payload: JourneyCohort = {
    roles: [{ jobId: "job-1", title: "Role", roleArea: null, n: 3 }],
    instances: [
      journey("h", ["matched", "added", "advanced", "interview_started", "offer_sent", "offer_accepted", "onboarding_started"], "hired"),
      journey("r", ["applied", "added", "screening_hold", "rejected", "rejection_sent"], "rejected"),
      journey("q", ["matched", "added", "advanced", "schedule_invite_sent"], "stalled"),
    ],
    scanned: 3, capped: false, asOf: at(30),
  };
  const all = hiringInstances(payload);
  assert.deepEqual([...new Set(all[0]?.steps.map((s) => s.k))], ["source", "screen", "interview", "offer", "onboard"]);
  const m = buildSpine(all, hiringFailure);
  const exits = m.stations.reduce((a, s) => a + s.exits, 0);
  assert.equal(exits, 1, "only the journey that went quiet is a failure; the rejection is not");
  assert.equal(m.stations[1]?.friction, 1, "the screening hold is friction on Screen");
});
