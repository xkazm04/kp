// The group-eval open machine (challenge-r03 group-eval-comparison/A): latest-wins
// opens, and every failure path reaching a named failed state instead of the
// "No evaluation yet" empty state or a spinner that never ends.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  groupEvalView,
  initialGroupEvalOpenState,
  planOpen,
  poolDrift,
  rerunSelection,
  stepGroupEvalOpen,
  type GroupEvalEvent,
  type GroupEvalOpenState,
  type GroupEvalStep,
} from "./groupEvalOpenMachine";
import type { GroupEvalPayload } from "@/app/features/shared/groupEvalTypes";
import type { Group } from "../decisionsQueueTypes";

const entry = (id: string, label = id) =>
  ({ id, candidateId: `c-${id}`, candidateLabel: label, matchScore: 70 }) as unknown as Group["entries"][number];
const group = (roleKey: string, ids: string[]): Group => ({ roleKey, roleTitle: `Role ${roleKey}`, jobId: `job-${roleKey}`, entries: ids.map((i) => entry(i)) });
const gov = { selected: "recommendation" as const, userChose: false };

const A = group("A", ["a1", "a2", "a3"]);
const B = group("B", ["b1", "b2", "b3"]);
const topN = (g: Group, roleEvaluated: boolean) => planOpen(g, { rerun: false, roleEvaluated, governanceMode: "recommendation" });
const selection = (g: Group, ids: string[]) => planOpen(g, { rerun: false, selection: ids, roleEvaluated: false, governanceMode: "recommendation" });

function run(events: GroupEvalEvent[], from: GroupEvalOpenState = initialGroupEvalOpenState()): { state: GroupEvalOpenState; steps: GroupEvalStep[] } {
  let state = from;
  const steps: GroupEvalStep[] = [];
  for (const ev of events) {
    const s = stepGroupEvalOpen(state, ev);
    steps.push(s);
    state = s.state;
  }
  return { state, steps };
}

const payloadA = { roleTitle: "Role A", governanceMode: "committee", evaluatedIds: ["a1", "a2", "a3"] } as GroupEvalPayload;
const payloadP = { roleTitle: "Role A", evaluatedIds: ["a1", "a2", "a3"] } as GroupEvalPayload;

/** An open that reached `running` on task-1. */
function running(plan = topN(A, false)) {
  return run([{ type: "open", plan }, { type: "startResolved", ticket: 1, started: { id: "task-1" } }]).state;
}

test("1. a probe for role A that lands after role B opened never paints A under B's title or re-syncs governance", () => {
  const { state, steps } = run([
    { type: "open", plan: topN(A, true) },
    { type: "open", plan: topN(B, true) },
    { type: "probeResolved", ticket: 1, probe: { evaluation: { payload: payloadA, createdAt: "2026-09-01T00:00:00Z" } }, governance: gov },
  ]);
  assert.equal(steps[0].effects[0]?.type, "probe");
  assert.equal(steps[1].state.ticket, 2);
  assert.equal(state.plan?.role.roleKey, "B", "the modal is still B's");
  assert.equal(state.phase.kind, "probing", "B is still probing");
  assert.equal(groupEvalView(state), "loading");
  assert.deepEqual(steps[2].effects, [], "no applyMode effect from A's payload");
  assert.equal(steps[2].state, steps[1].state, "the stale probe is a no-op");
});

test("2. a start that resolves after close() is dropped: idle, no task watched", () => {
  const { state, steps } = run([
    { type: "open", plan: topN(A, false) },
    { type: "close" },
    { type: "startResolved", ticket: 1, started: { id: "task-A" } },
  ]);
  assert.equal(steps[0].effects[0]?.type, "start");
  assert.equal(state.phase.kind, "idle");
  assert.equal(state.plan, null);
  assert.equal(groupEvalView(state), "idle");
  // A later open of B takes a fresh ticket and inherits nothing from task-A.
  const next = stepGroupEvalOpen(state, { type: "open", plan: topN(B, false) });
  assert.equal(next.state.phase.kind, "starting");
  assert.ok(next.state.ticket > 1);
});

test("3. a succeeded task whose result fetch gave up fails as result_unavailable, never spins", () => {
  const s = stepGroupEvalOpen(running(), {
    type: "taskWatch",
    watch: { taskId: "task-1", status: "succeeded", full: null, resultUnavailable: true },
  });
  assert.deepEqual(s.state.phase, { kind: "failed", code: "result_unavailable" });
  assert.equal(groupEvalView(s.state), "failed");
});

test("4. a failed / canceled / interrupted run fails as run_failed, never the noEval empty state", () => {
  for (const status of ["failed", "canceled", "interrupted"]) {
    const s = stepGroupEvalOpen(running(), { type: "taskWatch", watch: { taskId: "task-1", status, full: null, resultUnavailable: false } });
    assert.deepEqual(s.state.phase, { kind: "failed", code: "run_failed" }, status);
    assert.equal(groupEvalView(s.state), "failed", status);
  }
  // A watch for a DIFFERENT task id is not this run's outcome.
  const other = stepGroupEvalOpen(running(), { type: "taskWatch", watch: { taskId: "task-9", status: "failed", full: null, resultUnavailable: false } });
  assert.equal(other.state.phase.kind, "running");
});

test("5. startTask refused or unreachable fails as start_failed", () => {
  const { state } = run([{ type: "open", plan: topN(A, false) }, { type: "startResolved", ticket: 1, started: null }]);
  assert.deepEqual(state.phase, { kind: "failed", code: "start_failed" });
  assert.equal(groupEvalView(state), "failed");
});

test("6. a failed probe, a missing top-N payload, and a selection miss that spawns", () => {
  const probeFail = run([{ type: "open", plan: topN(A, true) }, { type: "probeResolved", ticket: 1, probe: null, governance: gov }]);
  assert.deepEqual(probeFail.state.phase, { kind: "failed", code: "probe_failed" });
  assert.deepEqual(probeFail.steps[1].effects, [], "a failed probe never spends: no start effect");

  const loadFail = run([{ type: "open", plan: topN(A, true) }, { type: "probeResolved", ticket: 1, probe: { evaluation: null }, governance: gov }]);
  assert.deepEqual(loadFail.state.phase, { kind: "failed", code: "load_failed" });

  const sel = selection(A, ["a1", "a2"]);
  assert.equal(sel.tryCache, true, "a selection always probes its own key");
  const miss = run([{ type: "open", plan: sel }, { type: "probeResolved", ticket: 1, probe: { evaluation: null }, governance: gov }]);
  assert.equal(miss.state.phase.kind, "starting");
  assert.deepEqual(miss.steps[1].effects, [{ type: "start", ticket: 1, params: sel.params }]);
});

test("7. poolDrift counts joins + leaves by id, by label for legacy payloads, else 0", () => {
  const live = { entries: [entry("b", "Bob"), entry("c", "Cy"), entry("d", "Dee")] };
  assert.equal(poolDrift({ evaluatedIds: ["a", "b", "c"] }, live), 2);
  assert.equal(poolDrift({ evaluatedLabels: ["Ann", "Bob"] }, { entries: [entry("x", "Bob"), entry("y", "Cy")] }), 2);
  assert.equal(poolDrift({}, live), 0);
  assert.equal(poolDrift({ evaluatedIds: ["a"] }, null), 0);
  assert.equal(poolDrift(null, live), 0);
});

test("8. a succeeded top-N run marks the role evaluated; a selection run does not", () => {
  const top = stepGroupEvalOpen(running(), { type: "taskWatch", watch: { taskId: "task-1", status: "succeeded", full: { result: payloadP }, resultUnavailable: false } });
  assert.equal(top.state.phase.kind, "ready");
  assert.equal(top.state.phase.kind === "ready" ? top.state.phase.payload : null, payloadP);
  assert.deepEqual(top.effects, [{ type: "markEvaluated", roleKey: "A" }]);

  const selRun = stepGroupEvalOpen(running(selection(A, ["a1", "a2"])), {
    type: "taskWatch",
    watch: { taskId: "task-1", status: "succeeded", full: { result: payloadP }, resultUnavailable: false },
  });
  // (the selection plan probes first; drive it to running explicitly)
  const selState = run([
    { type: "open", plan: selection(A, ["a1", "a2"]) },
    { type: "probeResolved", ticket: 1, probe: { evaluation: null }, governance: gov },
    { type: "startResolved", ticket: 1, started: { id: "task-1" } },
    { type: "taskWatch", watch: { taskId: "task-1", status: "succeeded", full: { result: payloadP }, resultUnavailable: false } },
  ]);
  assert.equal(selState.state.phase.kind, "ready");
  assert.deepEqual(selState.steps[3].effects, [], "a selection run never claims the role");
  assert.equal(selRun.state.phase.kind, "probing", "a start never resolves into a probing open");
});

test("a cache hit syncs governance through the server's ordering and carries its mismatch", () => {
  const hit = run([
    { type: "open", plan: topN(A, true) },
    { type: "probeResolved", ticket: 1, probe: { evaluation: { payload: payloadA, createdAt: "2026-09-01T00:00:00Z" } }, governance: gov },
  ]);
  assert.equal(hit.state.phase.kind, "ready");
  assert.deepEqual(hit.steps[1].effects, [{ type: "applyMode", mode: "committee" }]);
  // Re-run of a failed selection replays its own ids.
  const failedSel = run([
    { type: "open", plan: selection(A, ["a2", "a1"]) },
    { type: "probeResolved", ticket: 1, probe: null, governance: gov },
  ]);
  assert.deepEqual(rerunSelection(failedSel.state), ["a1", "a2"]);
  assert.equal(rerunSelection(hit.state), undefined, "a top-N payload re-runs as top-N");
});

test("the queue hook owns no inline open lifecycle any more", () => {
  const hook = readFileSync(new URL("../useDecisionsQueue.ts", import.meta.url), "utf8");
  assert.doesNotMatch(hook, /const evalDrift = \(\(\) =>/, "the drift rule lives in poolDrift");
  assert.doesNotMatch(hook, /setEvalTaskId\(started\.id\)/, "an un-ticketed start write is gone");
  const open = readFileSync(new URL("./useGroupEvalOpen.ts", import.meta.url), "utf8");
  assert.match(open, /resultUnavailable/, "the watch reads resultUnavailable");
  assert.match(open, /stepGroupEvalOpen/, "every write goes through the machine");
});
