// Real native better-sqlite3 first: the last test reads a ledger a real pass wrote.
import "better-sqlite3";
// IMPORT ORDER IS LOAD-BEARING: unit-db sets KP_DB_PATH before anything touches db-path.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { gateDwell, roleRunCoverage, roleRunGoalOneSteps, type GoalOneArtifact, type MetricArtifact } from "./role-run-metrics.ts";
import { SCREEN_ADVANCE_FLOOR, advanceRoleRun, commitRoleRunStageGate } from "./role-run-engine.ts";
import { getOrCreateRoleRun, listStageArtifacts } from "./db/role-runs.ts";
import { roleRunGateToken, type RoleRunGate } from "./role-run-gates.ts";
import { resetScreenWaveApprovalSpendForTests } from "./screen-wave-approval.ts";
import { ROLE_RUN_STAGES, type RoleRunStageKind, type RoleRunStageStatus } from "./role-run-stages.ts";
import { ensureDb, type JobRecord } from "./db/core.ts";
import { insertJob } from "./job-ingest.ts";
import { createPipelineEntry } from "./db/pipeline.ts";

before(() => ensureDb());
after(() => cleanupUnitDb());

const T0 = Date.parse("2026-03-10T09:00:00.000Z");
let seq = 0;
const art = (kind: RoleRunStageKind, status: RoleRunStageStatus, branchRef: string | null, minutes: number): MetricArtifact => ({
  kind,
  status,
  branchRef,
  seq: (seq += 1),
  producedAt: new Date(T0 + minutes * 60_000).toISOString(),
});

// ---- hand-built ledgers --------------------------------------------------------------

test("coverage counts only complete rows with no gate step in front, per kind and overall", () => {
  seq = 0;
  const rows = [
    art("role_spec", "complete", null, 0),
    art("slate", "complete", null, 1),
    art("screen", "awaiting_approval", "e1", 2),
    art("screen", "complete", "e1", 30), // the gate's resolution: a person committed it
    art("case_assignment", "complete", "e1", 31),
    art("screen", "awaiting_approval", "e2", 2), // still parked
  ];
  const c = roleRunCoverage(rows);
  assert.deepEqual(c.overall, { total: 6, autonomousComplete: 3, coverage: 0.5 });
  assert.deepEqual(c.byKind.role_spec, { total: 1, autonomousComplete: 1, coverage: 1 });
  assert.deepEqual(c.byKind.screen, { total: 3, autonomousComplete: 0, coverage: 0 }, "a gated stage is never autonomous, parked or resolved");
  assert.deepEqual(c.byKind.case_assignment, { total: 1, autonomousComplete: 1, coverage: 1 });
  assert.deepEqual(c.byKind.offer_draft, { total: 0, autonomousComplete: 0, coverage: null }, "a kind with no artifact has no coverage — not 0%");
  assert.deepEqual(Object.keys(c.byKind), [...ROLE_RUN_STAGES]);
  assert.ok(c.overall.autonomousComplete > 0, "NON-VACUITY: the fixture has autonomous rows, so an all-zero default fails here");
});

test("a complete row that follows a parked row on the same chain is a human step, even on an ungated kind", () => {
  seq = 0;
  const c = roleRunCoverage([art("scorecard", "awaiting_approval", "e1", 0), art("scorecard", "complete", "e1", 5), art("scorecard", "complete", "e2", 6)]);
  assert.equal(c.byKind.scorecard.autonomousComplete, 1, "only e2's row, which was never parked");
  assert.equal(c.byKind.scorecard.total, 3);
});

test("an empty ledger has no coverage and no dwell, and says so", () => {
  const c = roleRunCoverage([]);
  assert.equal(c.overall.coverage, null);
  assert.equal(c.overall.total, 0);
  assert.deepEqual(gateDwell([]), { entries: [], closed: 0, open: 0, unmeasurable: 0, medianClosedMs: null });
});

test("a parked gate is reported OPEN with dwell null — never now minus producedAt", () => {
  seq = 0;
  // producedAt is 1 January 2020: any now-minus-producedAt figure would be years, not null.
  const parked: MetricArtifact = { kind: "interview", status: "awaiting_approval", branchRef: "e1", seq: 1, producedAt: "2020-01-01T00:00:00.000Z" };
  const d = gateDwell([parked]);
  assert.equal(d.entries.length, 1, "NON-VACUITY: exactly one open dwell, so an empty default fails here");
  assert.equal(d.entries[0].state, "open");
  assert.equal(d.entries[0].dwellMs, null);
  assert.equal(d.entries[0].resolvedAt, null);
  assert.equal(d.open, 1);
  assert.equal(d.medianClosedMs, null, "an open gate contributes nothing to the closed median");
});

test("dwell runs to the next artifact of the SAME (kind, branch), not the next row in the ledger", () => {
  seq = 0;
  const rows = [
    art("screen", "awaiting_approval", "e1", 0),
    art("screen", "awaiting_approval", "e2", 1),
    art("interview", "awaiting_approval", "e1", 2), // a different kind on e1 — must not close e1's screen gate
    art("screen", "complete", "e2", 11), // closes e2: 10 min
    art("screen", "terminal", "e1", 60), // closes e1: 60 min
    art("interview", "complete", "e1", 62), // closes e1's interview: 60 min
  ];
  const d = gateDwell(rows);
  const byKey = Object.fromEntries(d.entries.map((e) => [`${e.kind}:${e.branchRef}`, e]));
  assert.equal(byKey["screen:e1"].dwellMs, 60 * 60_000);
  assert.equal(byKey["screen:e2"].dwellMs, 10 * 60_000);
  assert.equal(byKey["interview:e1"].dwellMs, 60 * 60_000);
  assert.equal(d.closed, 3);
  assert.equal(d.medianClosedMs, 60 * 60_000);
  assert.deepEqual(d.entries.map((e) => e.parkedSeq), [1, 2, 3], "ledger order");
});

test("a resolution whose clock does not give a non-negative interval claims no duration", () => {
  seq = 0;
  const d = gateDwell([art("screen", "awaiting_approval", "e1", 30), art("screen", "complete", "e1", 10)]);
  assert.equal(d.entries[0].state, "unmeasurable");
  assert.equal(d.entries[0].dwellMs, null);
  assert.equal(d.unmeasurable, 1);
  const bad = gateDwell([
    { kind: "screen", status: "awaiting_approval", branchRef: "e1", seq: 1, producedAt: "not a date" },
    { kind: "screen", status: "complete", branchRef: "e1", seq: 2, producedAt: "2026-03-10T09:00:00.000Z" },
  ]);
  assert.equal(bad.entries[0].state, "unmeasurable");
});

test("the two figures are separate reads: nothing exported folds them into one number", async () => {
  const mod = await import("./role-run-metrics.ts");
  assert.deepEqual(Object.keys(mod).sort(), ["gateDwell", "roleRunCoverage", "roleRunGoalOneSteps"], "ADR-0011: coverage and dwell, never a single time-to-hire; the goal-1 read is a third, separate question");
});

// ---- goal 1: gate approvals apart from human steps ------------------------------------

const gated = (kind: RoleRunStageKind, status: RoleRunStageStatus, branchRef: string, minutes: number, gate: RoleRunGate, decision: "approved" | "declined"): GoalOneArtifact => ({
  ...art(kind, status, branchRef, minutes),
  payload: { gate, decision },
});

test("goal 1: a gate approval is counted apart and is not a human step", () => {
  seq = 0;
  const g = roleRunGoalOneSteps([
    art("role_spec", "complete", null, 0),
    art("screen", "awaiting_approval", "e1", 1),
    gated("screen", "complete", "e1", 5, "rejection", "approved"),
  ]);
  assert.deepEqual(g.gateApprovals.rejection, { approved: 1, declined: 0 });
  assert.equal(g.humanStepsOutsideGates, 0, "the approval is an allowed step");
  assert.equal(g.goalOneComplete, 2, "the spec and the gate resolution both count; coverage would have refused the resolution");
  assert.equal(g.total, 3);
  assert.equal(roleRunCoverage([art("screen", "complete", "e1", 5)]).overall.autonomousComplete, 0, "coverage still reads a gated complete as human");
});

test("goal 1: an open gate is counted as open, not as a human step", () => {
  seq = 0;
  const g = roleRunGoalOneSteps([art("screen", "awaiting_approval", "e1", 0), art("screen", "awaiting_approval", "e2", 0), art("interview", "awaiting_approval", "e3", 1)]);
  assert.deepEqual(g.openGates, { rejection: 2, interview_invite: 1, offer: 0 });
  assert.equal(g.humanStepsOutsideGates, 0);
  assert.deepEqual(g.gateApprovals.rejection, { approved: 0, declined: 0 });
  assert.equal(g.verdict, "not met");
  assert.equal(g.reason, "stopped at the interview_invite gate: 1 awaiting approval (an allowed step)");
});

test("goal 1: a declined gate is counted as declined", () => {
  seq = 0;
  const g = roleRunGoalOneSteps([art("offer_draft", "awaiting_approval", "e1", 0), gated("offer_draft", "terminal", "e1", 3, "offer", "declined")]);
  assert.deepEqual(g.gateApprovals.offer, { approved: 0, declined: 1 });
  assert.equal(g.humanStepsOutsideGates, 0);
  assert.equal(g.verdict, "not met", "a declined offer is not a hire");
  assert.equal(g.reason, "every open branch ended at a gate by decision; no offer approved", "a declined offer did reach a resolved offer gate");
});

test("goal 1: a branch declined at an earlier gate, with nothing open, reads as ended by decision", () => {
  seq = 0;
  const g = roleRunGoalOneSteps([art("screen", "awaiting_approval", "e1", 0), gated("screen", "terminal", "e1", 1, "rejection", "declined")]);
  assert.equal(g.verdict, "not met");
  assert.equal(g.reason, "every open branch ended at a gate by decision; no offer approved");
});

test("goal 1: a gate still open outranks a declined one in the reason", () => {
  seq = 0;
  const g = roleRunGoalOneSteps([
    art("screen", "awaiting_approval", "e1", 0),
    gated("screen", "terminal", "e1", 1, "rejection", "declined"),
    art("screen", "awaiting_approval", "e2", 2),
  ]);
  assert.equal(g.reason, "stopped at the rejection gate: 1 awaiting approval (an allowed step)");
});

test("goal 1: approvals with no decline and no approved offer keep the older reason", () => {
  seq = 0;
  const g = roleRunGoalOneSteps([art("screen", "awaiting_approval", "e1", 0), gated("screen", "complete", "e1", 1, "rejection", "approved")]);
  assert.equal(g.verdict, "not met");
  assert.equal(g.reason, "no branch reached a resolved offer gate");
});

test("goal 1: a declined gate does not excuse a resolution row with no gate payload (fail closed)", () => {
  seq = 0;
  const g = roleRunGoalOneSteps([
    art("offer_draft", "awaiting_approval", "e1", 0),
    gated("offer_draft", "terminal", "e1", 1, "offer", "declined"),
    art("screen", "awaiting_approval", "e2", 2),
    art("screen", "complete", "e2", 3),
  ]);
  assert.equal(g.humanStepsOutsideGates, 1);
  assert.equal(g.reason, "1 human step outside the gates");
});

test("goal 1: an empty ledger reads not measured", () => {
  const g = roleRunGoalOneSteps([]);
  assert.equal(g.verdict, "not measured");
  assert.equal(g.reason, "no stage produced an artifact");
  assert.deepEqual([g.total, g.goalOneComplete, g.humanStepsOutsideGates], [0, 0, 0]);
});

test("goal 1: a ledger resolved through the offer gate with only gate approvals reads met", () => {
  seq = 0;
  const rows: GoalOneArtifact[] = [
    art("role_spec", "complete", null, 0),
    art("slate", "complete", null, 1),
    art("screen", "awaiting_approval", "e1", 2),
    gated("screen", "complete", "e1", 3, "rejection", "approved"),
    art("case_assignment", "complete", "e1", 4),
    art("interview", "awaiting_approval", "e1", 5),
    gated("interview", "complete", "e1", 6, "interview_invite", "approved"),
    art("scorecard", "complete", "e1", 7),
    art("offer_draft", "awaiting_approval", "e1", 8),
    gated("offer_draft", "complete", "e1", 9, "offer", "approved"),
  ];
  const g = roleRunGoalOneSteps(rows);
  assert.equal(g.verdict, "met");
  assert.equal(g.reason, null);
  assert.equal(g.humanStepsOutsideGates, 0);
  assert.deepEqual(Object.values(g.gateApprovals).map((t) => t.approved), [1, 1, 1]);
  assert.deepEqual(g.openGates, { rejection: 0, interview_invite: 0, offer: 0 });
  assert.equal(g.goalOneComplete, 7, "every complete row counts: gate approvals are allowed");
});

test("goal 1: a resolution with no gate payload is a human step outside the gates, and blocks met", () => {
  seq = 0;
  const g = roleRunGoalOneSteps([
    art("offer_draft", "awaiting_approval", "e1", 0),
    gated("offer_draft", "complete", "e1", 1, "offer", "approved"),
    art("screen", "awaiting_approval", "e2", 2),
    art("screen", "complete", "e2", 3), // resolved by something that is not a gate commit
    gated("screen", "complete", "e3", 4, "offer", "approved"), // wrong gate for the stage, and never parked: ignored
  ]);
  assert.equal(g.humanStepsOutsideGates, 1);
  assert.equal(g.verdict, "not met");
  assert.equal(g.reason, "1 human step outside the gates");
  assert.equal(g.goalOneComplete, 2, "the unattributable resolution is not counted");
});

test("goal 1: the coverage and dwell results do not move when the same rows carry payloads", () => {
  seq = 0;
  const rows = [art("screen", "awaiting_approval", "e1", 0), gated("screen", "complete", "e1", 30, "rejection", "approved"), art("screen", "awaiting_approval", "e2", 1)];
  assert.deepEqual(roleRunCoverage(rows).overall, { total: 3, autonomousComplete: 0, coverage: 0 });
  assert.equal(gateDwell(rows).closed, 1);
  assert.equal(gateDwell(rows).open, 1);
});

// ---- a ledger a real pass wrote --------------------------------------------------------

const SCREEN_POLICY = `screen-1@${SCREEN_ADVANCE_FLOOR}`;
const GATE_POLICY: Record<RoleRunGate, string> = { rejection: SCREEN_POLICY, interview_invite: "invite-1", offer: "offer-1" };

function decide(runId: string, branchRef: string, gate: RoleRunGate) {
  const now = Date.now();
  return commitRoleRunStageGate({
    runId,
    branchRef,
    gate,
    decision: "approved",
    policyVersion: GATE_POLICY[gate],
    subjectRefs: [branchRef],
    token: roleRunGateToken(runId, gate, GATE_POLICY[gate], [branchRef], now),
    approver: "recruiter-1",
    now,
  });
}

async function drain(runId: string): Promise<void> {
  for (let i = 0; i < 40; i += 1) if ((await advanceRoleRun(runId)).produced.length === 0) return;
}

test("both reads hold over the real ledger shape the default runners write", async () => {
  resetScreenWaveApprovalSpendForTests();
  insertJob(
    { id: "jd-metrics", title: "Role jd-metrics", requirements: [{ skill: "java", kind: "skill", hardness: "must" }] } as unknown as JobRecord,
    undefined,
    "published"
  );
  const seed = (id: string, score: number) =>
    createPipelineEntry({ candidateId: id, candidateLabel: `Candidate ${id}`, jobId: "jd-metrics", jobTitle: "Role jd-metrics", matchScore: score }).entry.id;
  const a = seed("cand-a", 91);
  const b = seed("cand-b", 88);
  const { run } = getOrCreateRoleRun({ jobId: "jd-metrics" });

  await drain(run.id); // both branches park at the rejection gate
  decide(run.id, a, "rejection");
  await drain(run.id); // a runs the case and parks at the invite gate; b is still parked
  decide(run.id, a, "interview_invite");
  await drain(run.id); // a scores and its offer is drafted, parked at the offer gate

  const rows = listStageArtifacts(run.id);
  const coverage = roleRunCoverage(rows);
  assert.equal(coverage.overall.total, rows.length, "every real row is in the denominator");
  assert.ok(coverage.overall.autonomousComplete > 0, "NON-VACUITY: the run produced unattended stages");
  assert.ok(coverage.overall.coverage !== null && coverage.overall.coverage > 0 && coverage.overall.coverage < 1, "some rows autonomous, some behind a gate");
  for (const kind of ["role_spec", "slate", "case_assignment", "scorecard"] as const) {
    assert.equal(coverage.byKind[kind].coverage, 1, `${kind} is unattended: every artifact of it is autonomous`);
  }
  for (const kind of ["screen", "interview", "offer_draft"] as const) {
    assert.equal(coverage.byKind[kind].coverage, 0, `${kind} is gated: none of it is autonomous`);
    assert.ok(coverage.byKind[kind].total > 0);
  }

  const dwell = gateDwell(rows);
  const key = (e: { kind: string; branchRef: string | null }) => `${e.kind}:${e.branchRef}`;
  const state = Object.fromEntries(dwell.entries.map((e) => [key(e), e.state]));
  assert.deepEqual(state, {
    [`screen:${a}`]: "closed",
    [`screen:${b}`]: "open",
    [`interview:${a}`]: "closed",
    [`offer_draft:${a}`]: "open",
  });
  assert.equal(dwell.open, 2, "b's screen and a's offer are still parked");
  assert.ok(dwell.entries.filter((e) => e.state === "closed").every((e) => (e.dwellMs ?? -1) >= 0));
  assert.ok(dwell.entries.filter((e) => e.state === "open").every((e) => e.dwellMs === null));
});
