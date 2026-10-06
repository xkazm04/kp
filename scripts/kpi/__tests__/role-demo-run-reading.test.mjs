// Fixtures for the pure half of the goal-1 demo-run instrument. The failure these exist for:
// a reading that prints a number when the run measured nothing — an empty ledger, a cancelled
// run, an empty slate — or that hides which gate a branch is parked at.
//
//   node --test scripts/kpi/__tests__/role-demo-run-reading.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GATE_OF_STAGE, STAGE_ORDER, STAND_IN_APPROVER, formatCoverage, formatGateCounts, goalOneHeadline, standInLine, stagesReached, stoppedAt, summarizeRoleDemoRun } from "../role-demo-run-reading.mjs";

let seq = 0;
const art = (kind, branchRef, status, payload) => ({ kind, branchRef, status, seq: ++seq, payload });

const spec = () => art("role_spec", null, "complete", { lintFindings: [] });
const slate = (...refs) => art("slate", null, "complete", { candidates: refs.map((candidateRef) => ({ candidateRef })) });

test("an empty ledger is not measured", () => {
  const r = summarizeRoleDemoRun({ runStatus: "running", artifacts: [] });
  assert.equal(r.measured, false);
  assert.equal(r.headline, "not measured: no stage produced an artifact");
  assert.equal(r.furthest, null);
});

test("a cancelled run gives the reason its role spec recorded", () => {
  const r = summarizeRoleDemoRun({
    runStatus: "cancelled",
    artifacts: [art("role_spec", null, "terminal", { lintFindings: ["job_not_found"] })],
  });
  assert.equal(r.measured, false);
  assert.equal(r.headline, "not measured: run cancelled (job_not_found)");
});

test("a cancelled run with no recorded finding still says it was cancelled", () => {
  const r = summarizeRoleDemoRun({ runStatus: "cancelled", artifacts: [spec()] });
  assert.equal(r.headline, "not measured: run cancelled");
});

test("a slate with no candidates is not measured", () => {
  const r = summarizeRoleDemoRun({ runStatus: "running", artifacts: [spec(), slate()] });
  assert.equal(r.measured, false);
  assert.match(r.headline, /^not measured: no slate formed/);
});

test("branches parked at the rejection gate are named, with the furthest stage", () => {
  const r = summarizeRoleDemoRun({
    runStatus: "running",
    artifacts: [spec(), slate("e1", "e2", "e3"), ...["e1", "e2", "e3"].map((e) => art("screen", e, "awaiting_approval"))],
  });
  assert.equal(r.measured, true);
  assert.equal(r.furthest, "screen");
  assert.equal(r.headline, "reached screen; 3 branches parked at gates rejection");
  assert.deepEqual(r.parkedByGate, { rejection: ["e1", "e2", "e3"] });
});

test("branches at different gates are all named, and a resolved gate is not parked", () => {
  const r = summarizeRoleDemoRun({
    runStatus: "running",
    artifacts: [
      spec(),
      slate("a", "b", "c"),
      art("screen", "a", "awaiting_approval"),
      art("screen", "b", "awaiting_approval"),
      art("screen", "b", "complete"),
      art("case_assignment", "b", "complete"),
      art("interview", "b", "awaiting_approval"),
      art("screen", "c", "awaiting_approval"),
      art("screen", "c", "terminal"),
    ],
  });
  assert.equal(r.headline, "reached interview; 2 branches parked at gates rejection, interview_invite");
  assert.deepEqual(r.parkedByGate, { rejection: ["a"], interview_invite: ["b"] });
});

test("one parked branch reads in the singular", () => {
  const r = summarizeRoleDemoRun({ runStatus: "running", artifacts: [spec(), slate("a"), art("screen", "a", "awaiting_approval")] });
  assert.equal(r.headline, "reached screen; 1 branch parked at gates rejection");
});

test("a blocked stage is named with what it needs and is never stubbed over", () => {
  const r = summarizeRoleDemoRun({
    runStatus: "running",
    artifacts: [spec(), slate("a"), art("screen", "a", "awaiting_approval")],
    blocked: { stage: "case_assignment", needs: "an LLM key" },
  });
  assert.equal(r.headline, "not measured: case_assignment needs an LLM key");
});

test("an engine failure is not measured and carries its message", () => {
  const r = summarizeRoleDemoRun({ runStatus: "running", artifacts: [spec()], failure: "engine threw after 1 pass: boom" });
  assert.equal(r.headline, "not measured: engine threw after 1 pass: boom");
});

// ---- the goal-1 headline: three forms, and a run that could not be read keeps its cause ----

const measured = { measured: true, headline: "reached screen; 20 branches parked at gates rejection" };

test("goal 1 met leads with 'goal 1: met'", () => {
  assert.equal(goalOneHeadline({ verdict: "met", reason: null }, measured), "goal 1: met");
});

test("goal 1 not met names the reason, an open gate being an allowed step", () => {
  const reason = "stopped at the rejection gate: 20 awaiting approval (an allowed step)";
  assert.equal(goalOneHeadline({ verdict: "not met", reason }, measured), `goal 1: not met: ${reason}`);
});

test("an empty ledger's goal-1 verdict is 'not measured', never 'not met'", () => {
  assert.equal(goalOneHeadline({ verdict: "not measured", reason: "no stage produced an artifact" }, measured), "not measured: no stage produced an artifact");
});

test("a run that could not be read keeps its own cause over the goal-1 verdict", () => {
  const unread = summarizeRoleDemoRun({ runStatus: "cancelled", artifacts: [art("role_spec", null, "terminal", { lintFindings: ["job_not_found"] })] });
  assert.equal(goalOneHeadline({ verdict: "not met", reason: "no branch reached a resolved offer gate" }, unread), "not measured: run cancelled (job_not_found)");
});

// ---- --approve-gates: a reading that says who approved the gates -----------------------

test("a met verdict with stand-in approvals says the gates were approved by the demo stand-in", () => {
  assert.equal(goalOneHeadline({ verdict: "met", reason: null }, { measured: true, headline: "reached offer_draft; 0 branches parked at gates" }, { rejection: 20, interview_invite: 4, offer: 1 }), "goal 1: met (gates approved by demo stand-in)");
  assert.equal(standInLine({ rejection: 20, interview_invite: 4, offer: 1 }), "gates approved by the demo stand-in, not a person: rejection 20 · interview_invite 4 · offer 1");
  assert.equal(STAND_IN_APPROVER, "demo-stand-in");
});

test("a run stopped at a later gate says so, and still names the stand-in", () => {
  const reason = "stopped at the interview_invite gate: 3 awaiting approval (an allowed step)";
  const headline = goalOneHeadline({ verdict: "not met", reason }, measured, { rejection: 20, interview_invite: 0, offer: 0 });
  assert.equal(headline, `goal 1: not met: ${reason} (gates approved by demo stand-in)`);
  assert.equal(standInLine({ rejection: 20, interview_invite: 0, offer: 0 }), "gates approved by the demo stand-in, not a person: rejection 20 · interview_invite 0 · offer 0");
});

test("without the flag the headline carries no stand-in wording", () => {
  assert.equal(goalOneHeadline({ verdict: "met", reason: null }, measured), "goal 1: met");
  assert.equal(goalOneHeadline({ verdict: "met", reason: null }, measured, null), "goal 1: met");
});

test("a run that could not be read keeps its cause even with the stand-in on", () => {
  const unread = summarizeRoleDemoRun({ runStatus: "running", artifacts: [spec()], failure: "engine threw after 2 passes at the slate stage (inferred from the ledger): needs a key" });
  assert.equal(goalOneHeadline({ verdict: "not met", reason: "x" }, unread, { rejection: 0, interview_invite: 0, offer: 0 }), "not measured: engine threw after 2 passes at the slate stage (inferred from the ledger): needs a key");
});

test("stages reached count chains per stage in ladder order", () => {
  const rows = [spec(), slate("a", "b"), art("screen", "a", "awaiting_approval"), art("screen", "b", "awaiting_approval"), art("screen", "a", "complete"), art("case_assignment", "a", "complete")];
  assert.deepEqual(stagesReached(rows), [
    { kind: "role_spec", chains: 1 },
    { kind: "slate", chains: 1 },
    { kind: "screen", chains: 2 },
    { kind: "case_assignment", chains: 1 },
  ]);
  assert.deepEqual(stagesReached([]), []);
});

test("where it stopped: a failure, a gate, a finished run, or nothing left", () => {
  assert.equal(stoppedAt({ runStatus: "running", parkedByGate: {}, failure: "engine threw after 1 pass: boom" }), "engine threw after 1 pass: boom");
  assert.equal(stoppedAt({ runStatus: "running", parkedByGate: { rejection: ["a", "b"], offer: ["c"] } }), "awaiting approval at rejection (2), offer (1)");
  assert.equal(stoppedAt({ runStatus: "complete", parkedByGate: {} }), "run complete: every branch ended");
  assert.equal(stoppedAt({ runStatus: "running", parkedByGate: {}, capped: true }), "the pass ceiling, with the run still running");
  assert.equal(stoppedAt({ runStatus: "running", parkedByGate: {} }), "nothing left to produce");
});

test("per-gate counts print in the order given, zeros included", () => {
  assert.equal(formatGateCounts({ rejection: 20, interview_invite: 0, offer: 0 }), "rejection 20 · interview_invite 0 · offer 0");
});

test("a coverage row with nothing to divide is n/a, not a percentage", () => {
  assert.equal(formatCoverage({ total: 0, autonomousComplete: 0, coverage: null }), "n/a (0 artifacts)");
  assert.equal(formatCoverage({ total: 4, autonomousComplete: 1, coverage: 0.25 }), "1/4 (25%)");
});

test("the restated ladder and gate map still match the engine's source", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const stages = readFileSync(path.join(root, "app/_lib/role-run-stages.ts"), "utf8");
  const literal = stages.match(/ROLE_RUN_STAGES = \[([\s\S]*?)\] as const/)[1];
  assert.deepEqual([...literal.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]), STAGE_ORDER);
  const gates = readFileSync(path.join(root, "app/_lib/role-run-gates.ts"), "utf8");
  const map = gates.match(/GATE_STAGE[^=]*= \{([\s\S]*?)\}/)[1];
  const fromSource = Object.fromEntries([...map.matchAll(/(\w+):\s*"(\w+)"/g)].map((m) => [m[2], m[1]]));
  assert.deepEqual(fromSource, GATE_OF_STAGE);
});
