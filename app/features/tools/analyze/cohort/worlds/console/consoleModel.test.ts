import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CohortView } from "../../cohortTypes.ts";
import {
  BUS_ORDER, SEGMENTS, absentTally, busClaim, busLeader, hasComment, labelOf, litSegments, masterClaim, noiseGroup, patchOrder,
  stripState, travel, trustLamps,
} from "./consoleModel.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = (kind: "done" | "running"): CohortView =>
  JSON.parse(fs.readFileSync(path.join(HERE, "../../../../../../../public/dev/cohort", `cohort20.${kind}.json`), "utf8")) as CohortView;
const done = load("done");
const running = load("running");

test("the desk draws every dimension once, the fader last", () => {
  assert.equal(new Set(BUS_ORDER).size, 7);
  assert.equal(BUS_ORDER[BUS_ORDER.length - 1], "fit");
});

test("neutral patch is the presentation shuffle and is the same while a cohort runs", () => {
  const n = patchOrder(done.members, "neutral");
  assert.deepEqual(n.map((m) => m.neutralIndex), [...n.keys()]);
  // no reflow as members land: the running and the done cohort patch the same strips in the same places
  assert.deepEqual(patchOrder(running.members, "neutral").map((m) => m.memberId), n.map((m) => m.memberId));
});

test("fit patch puts the rated first by rank and the unrated last in neutral order", () => {
  const f = patchOrder(done.members, "fit");
  const rated = f.filter((m) => m.fitRank != null);
  assert.equal(f[0].fitRank, 1);
  assert.deepEqual(rated.map((m) => m.fitRank), [...rated.map((m) => m.fitRank as number)].sort((a, b) => a - b));
  const tail = f.slice(rated.length);
  assert.ok(tail.every((m) => m.fitRank == null));
  assert.deepEqual(tail.map((m) => m.neutralIndex), [...tail.map((m) => m.neutralIndex)].sort((a, b) => a - b));
  assert.notEqual(patchOrder(done.members, "fit"), done.members);
});

test("a rated 0 lights no segment and is still a rating; absent is null, never 0", () => {
  assert.equal(litSegments(0), 0);
  assert.equal(litSegments(100), SEGMENTS);
  assert.equal(litSegments(85), 9);
  assert.equal(litSegments(null), null);
  assert.equal(litSegments(Number.NaN), null);
  assert.equal(travel(140), 1);
  assert.equal(travel(-3), 0);
});

test("strip states follow the run", () => {
  const states = new Set(running.members.map(stripState));
  assert.deepEqual([...states].sort(), ["failed", "live", "pending"]);
  assert.equal(stripState(done.members.find((m) => m.runState === "reused")!), "live");
});

test("trust lamps: warn peaks, a blocker clips, an absent trust read is unlit (null)", () => {
  const klara = done.members.find((m) => m.memberId === "analysis-cand-000")!;
  assert.deepEqual(trustLamps(klara), { peak: true, clip: false });
  const blocked = done.members.find((m) => m.detail.trust?.findings.some((f) => f.severity === "blocker"))!;
  assert.equal(trustLamps(blocked)?.clip, true);
  const unread = done.members.find((m) => m.cells.trust.tier === "absent")!;
  assert.equal(trustLamps(unread), null);
});

test("a bus names a leader only when the claim clears; salary is never ranked", () => {
  assert.deepEqual(busClaim(done, "publicWork"), { kind: "lead", leader: "analysis-cand-000" });
  assert.deepEqual(busClaim(done, "fit"), { kind: "noise" });
  assert.deepEqual(busClaim(done, "salary"), { kind: "unranked", partitions: 2 });
  const forged: CohortView = structuredClone(done);
  forged.claims.byDimension.salary = { ...forged.claims.byDimension.salary, separation: "clears", leader: "analysis-cand-000" };
  assert.equal(busLeader(forged, "salary"), null);
  forged.claims.byDimension.skills = { ...forged.claims.byDimension.skills, separation: "belowFloor", leader: null };
  assert.deepEqual(busClaim(forged, "skills"), { kind: "floor" });
});

test("the master claim: no crown inside the noise", () => {
  assert.deepEqual(masterClaim(done), { kind: "noise" });
  const clears: CohortView = structuredClone(done);
  clears.claims.overall = { leader: "analysis-cand-000", separation: "clears", robustness: "stable" };
  assert.deepEqual(masterClaim(clears), { kind: "lead", leader: "analysis-cand-000" });
  clears.claims.overall = { leader: null, separation: "clears", robustness: "stable" };
  assert.deepEqual(masterClaim(clears), { kind: "noise" });
});

test("the noise group is the members whose fit band overlaps the first-ranked band", () => {
  const g = noiseGroup(done)!;
  assert.deepEqual(g.ids.sort(), ["analysis-cand-000", "analysis-cand-040"]);
  assert.equal(g.lo, 85);
  assert.equal(g.hi, 100);
  const clears: CohortView = structuredClone(done);
  clears.claims.overall.separation = "clears";
  assert.equal(noiseGroup(clears), null);
});

test("absent tally counts each reason on a bus, never a pending as a zero", () => {
  const pw = absentTally(done, "publicWork");
  assert.equal(pw.reduce((s, r) => s + r.n, 0), done.members.filter((m) => m.cells.publicWork.tier === "absent").length);
  assert.equal(pw[0].reason, "notRead");
  const pending = absentTally(running, "fit").find((r) => r.reason === "pending");
  assert.equal(pending?.n, running.members.filter((m) => m.runState === "queued" || m.runState === "analyzing").length);
});

test("labels and comments", () => {
  assert.equal(labelOf(done, "analysis-cand-007"), "Vít Malý");
  assert.equal(labelOf(done, "nobody"), null);
  assert.equal(labelOf(done, null), null);
  assert.equal(done.members.filter(hasComment).length, 4);
});
