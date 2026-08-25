// The stub Personas bridge, driven over its own socket.
//
//   node --test scripts/app-master-bench/
//
// The stub exists so the driver's plumbing can be proven with no Personas and
// no kp. Its numbers are canned; its SHAPES are not, and since P6f neither is
// its timing: a dispatched night's branches appear only on the Nth `reconcile`
// (`STUB_BRANCH_DELAY_RECONCILES`, default 2), the way a real fleet's do. That
// is what makes the stub able to FAIL a driver that reconciles and reports in
// the same breath — which is exactly what the 2026-08-25 sweep did.

import test from "node:test";
import assert from "node:assert/strict";
import { cannedNight, cannedProbation, cannedReconcile, startStubPersonas } from "./stub.mjs";
import { accountedBy, dispatchedCount, settleDispatch } from "./run.mjs";
import { phaseCounts } from "./expectations.mjs";
import { DRIVER_ORIGIN, personasClient } from "./lib.mjs";

const APP_MASTER = {
  role: { title: "App master for kp", population: "agent" },
  mandate: { scopeRung: 2 },
  budget: { monthlyUsd: 120 },
  objectives: [{ kpiKey: "gate_pass_rate", target: 95, direction: "gte", windowDays: 60 }],
};

const freshState = (over = {}) => ({
  opened: 0,
  merged: 0,
  settledUsd: 0,
  gatesRun: 0,
  gatesPassed: 0,
  nights: 0,
  pendingSeeds: 3,
  awaitingBranches: 0,
  pendingMerges: 0,
  branchesRecorded: 0,
  reconcilesSinceDispatch: 0,
  ...over,
});

test("a dispatch is not a branch: the counters move on reconcile, not on overnight", () => {
  const state = freshState();
  const night = cannedNight(state, APP_MASTER);
  assert.equal(night.opened, 3, "three seeds, three sessions dispatched");
  assert.equal(state.opened, 0, "nothing is a recorded proposal yet");
  assert.equal(state.awaitingBranches, 3);

  const first = cannedReconcile(state);
  assert.equal(first.counts.branchesSeen, 0, "the fleet has not written anything yet");
  assert.equal(state.opened, 0);

  const second = cannedReconcile(state);
  assert.equal(second.counts.branchesSeen, 3);
  assert.equal(second.counts.newlyRecorded, 3);
  assert.equal(second.counts.gated, 3);
  assert.equal(state.opened, 3, "now they are proposals");
  assert.equal(state.merged, 2, "the canned night merges all but one");
  assert.equal(state.gatesRun, 18);

  // A third reconcile finds nothing new — there is nothing left in flight.
  assert.equal(cannedReconcile(state).counts.branchesSeen, 0);
  assert.equal(state.opened, 3);
});

test("the branch delay is configurable, and a rung-0 night never has one", () => {
  const slow = freshState();
  cannedNight(slow, APP_MASTER);
  assert.equal(cannedReconcile(slow, 4).counts.branchesSeen, 0);
  assert.equal(cannedReconcile(slow, 4).counts.branchesSeen, 0);
  assert.equal(cannedReconcile(slow, 4).counts.branchesSeen, 0);
  assert.equal(cannedReconcile(slow, 4).counts.branchesSeen, 3);

  const readOnly = freshState();
  const night = cannedNight(readOnly, { ...APP_MASTER, mandate: { scopeRung: 0 } });
  assert.equal(night.opened, 0);
  assert.match(night.blockedReason, /rung 0/);
  assert.equal(cannedReconcile(readOnly).counts.branchesSeen, 0);
  assert.equal(cannedReconcile(readOnly).counts.branchesSeen, 0, "nothing was dispatched, so nothing lands");
  assert.deepEqual(cannedProbation(readOnly, { ...APP_MASTER, mandate: { scopeRung: 0 } }).decision, "extended");
});

// ─── over the wire ──────────────────────────────────────────────────────────

/** Boot the stub, pair the way the driver does, and hand back a tick caller. */
async function bootStub(opts = {}) {
  const stub = await startStubPersonas(opts);
  const call = async (path, { method = "GET", body, key = stub.apiKey } = {}) => {
    const res = await fetch(stub.url + path, {
      method,
      headers: {
        origin: DRIVER_ORIGIN,
        ...(key ? { authorization: `Bearer ${key}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { ok: res.ok, status: res.status, json: await res.json().catch(() => null) };
  };
  const dispatched = await call("/api/kp/persona-requests", {
    method: "POST",
    body: { spec: { name: "App master" }, appMaster: APP_MASTER, reportToken: "", kp: {} },
  });
  const personaId = (await call(`/api/kp/persona-requests/${dispatched.json.data.requestId}`)).json.data.personaId;
  const tick = (phases) => call("/api/kp/test/tick", { method: "POST", body: { personaId, phases } });
  return { stub, call, personaId, tick };
}

test("the canned flow is green end to end: health, pair, dispatch, seed, night", async (t) => {
  const { stub, call, personaId, tick } = await bootStub();
  t.after(() => stub.close());

  const health = await call("/health");
  assert.deepEqual(health.json, { status: "ok", management: true, headlessBridge: true });

  const seeded = await call("/api/kp/test/seed-work", {
    method: "POST",
    body: { personaId, items: [{ title: "Document KP_TRUSTED_PROXY" }, { title: "Fence attachment text" }] },
  });
  assert.equal(seeded.json.data.seed.seeded, 2);
  assert.equal(seeded.json.data.seed.triageRule.willAccept, true);
  // The same seed twice is a dedup, not a second idea.
  const again = await call("/api/kp/test/seed-work", {
    method: "POST",
    body: { personaId, items: [{ title: "Document KP_TRUSTED_PROXY" }] },
  });
  assert.equal(again.json.data.seed.skipped, 1);

  const overnight = await tick(["overnight"]);
  assert.equal(overnight.ok, true);
  assert.equal(dispatchedCount(overnight.json.data), 2);

  // Settle, then report — the driver's own night order, against the stub.
  const settle = await settleDispatch({
    tickReconcile: async () => {
      const res = await tick(["reconcile"]);
      return { ok: res.ok, summary: res.json?.data ?? null };
    },
    journal: null,
    night: 1,
    dispatched: 2,
    pollMs: 0,
    timeoutMs: 10_000,
  });
  assert.equal(settle.stoppedBy, "accounted");
  assert.equal(settle.polls.length, 2, "the stub's branches land on the second reconcile");

  const report = await tick(["report"]);
  const backbone = phaseCounts(report.json.data, "report") ?? report.json.data.phases.report.backbone;
  assert.equal(backbone.proposalsOpened, 2, "the settled night reports what reconcile recorded");
  assert.equal(backbone.proposalsMerged, 1);
  assert.ok(backbone.gatePassRate > 0.9, "gate outcomes exist because reconcile ran first");

  const probation = await tick(["probation"]);
  assert.equal(probation.json.data.phases.probation.decision, "activated");
  assert.equal(stub.unauthorizedCalls, 0);
  assert.deepEqual(stub.unknownPaths, []);
});

test("reporting WITHOUT settling reproduces the sweep: a delivered night that measures nothing", async (t) => {
  const { stub, call, personaId, tick } = await bootStub();
  t.after(() => stub.close());
  await call("/api/kp/test/seed-work", { method: "POST", body: { personaId, items: [{ title: "One task" }] } });

  // The OLD night order, in one breath: overnight → reconcile → report.
  const all = await tick(["overnight", "reconcile", "report"]);
  const counts = phaseCounts(all.json.data, "reconcile");
  assert.equal(accountedBy(counts), 0, "reconcile ran before the fleet wrote anything");
  const backbone = all.json.data.phases.report.backbone;
  assert.equal(backbone.proposalsOpened, 0, "…so the rollup reports a night that opened nothing");
  assert.equal(backbone.gatePassRate, null, "…and the gate lane is unmeasured, exactly as sweep 2026-08-25 read it");
});

test("an expired key gets ONE re-pair and ONE retry, then the 401 is returned as data", async (t) => {
  // Personas' headless auto-pair mints 24-hour keys. Sweep #15 crossed that
  // boundary mid-run and lost a scenario's seed phase to `401 invalid api key`
  // on a key that had simply aged out overnight.
  const stub = await startStubPersonas();
  t.after(() => stub.close());

  let repairs = 0;
  const client = personasClient(stub.url, "pk_expired_yesterday", {
    onUnauthorized: async ({ route, status }) => {
      repairs += 1;
      assert.equal(status, 401);
      assert.equal(route, "/api/kp/connector-catalog");
      client.setKey(stub.apiKey); // "re-paired"
      return true;
    },
  });
  const res = await client.get("/api/kp/connector-catalog");
  assert.equal(res.ok, true, "the retry ran with the fresh key");
  assert.equal(res.repaired, true, "…and the result says it was repaired, so the journal can record it");
  assert.equal(repairs, 1);

  // A repair that does NOT fix it must not loop: one retry, then the 401 is the
  // caller's answer.
  let futile = 0;
  const doomed = personasClient(stub.url, "pk_still_wrong", {
    onUnauthorized: async () => {
      futile += 1;
      return true;
    },
  });
  const failed = await doomed.get("/api/kp/connector-catalog");
  assert.equal(failed.status, 401);
  assert.equal(futile, 1, "exactly one repair attempt per call");
});

test("the stub still refuses an unauthorized call and an unknown route", async (t) => {
  const { stub, call } = await bootStub();
  t.after(() => stub.close());
  assert.equal((await call("/api/kp/connector-catalog", { key: null })).status, 401);
  assert.equal(stub.unauthorizedCalls, 1);
  assert.equal((await call("/api/kp/nope")).status, 404);
  assert.deepEqual(stub.unknownPaths, ["GET /api/kp/nope"]);
});
