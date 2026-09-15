// Import the REAL native better-sqlite3 first (never a shim): the contract is about rows
// a real run writes into the real schema, so nothing here is a hand-built ledger.
import "better-sqlite3";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
// IMPORT ORDER IS LOAD-BEARING: unit-db sets KP_DB_PATH before anything touches db-path.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { SCREEN_ADVANCE_FLOOR, advanceRoleRun, commitRoleRunStageGate, type AdvanceResult } from "./role-run-engine.ts";
import { getOrCreateRoleRun, getRoleRun, listStageArtifacts } from "./db/role-runs.ts";
import { GATE_STAGE, isRoleRunGateSpent, roleRunGateToken, type RoleRunGate } from "./role-run-gates.ts";
import { resetScreenWaveApprovalSpendForTests } from "./screen-wave-approval.ts";
import {
  ROLE_RUN_STAGES,
  ROLE_RUN_STAGE_STATUSES,
  RoleRunTransitionError,
  STAGE_GATE,
  completedStagesFor,
  findRoleRunTransitionViolations,
  nextStageFor,
  type RoleRunStageKind,
} from "./role-run-stages.ts";
import { ensureDb, type JobRecord } from "./db/core.ts";
import { insertJob } from "./job-ingest.ts";
import { createPipelineEntry } from "./db/pipeline.ts";

// THE LEDGER'S CONTRACT, BOTH DIRECTIONS (ADR-0009 §2, in the shape of ADR-0008).
//
//   1. A stage may not READ complete without its artifact row. Nothing the engine
//      reports — a produced stage, a parked gate, a completed run — may be a claim the
//      rows cannot back.
//   2. An artifact row may not EXIST for a stage the transition table says is
//      unreachable. Every row a real run writes, in every shape a run ends in, replays
//      as a legal chain; and a runner that tries to write an unreachable one is refused
//      before the row lands.
//
// And the claim the resume read exists for: a half-finished run is reconstructed from
// the store with zero in-memory state — the connection is closed and reopened, and the
// read over the reopened rows predicts exactly what the next pass produces.

const SCREEN_POLICY = `screen-1@${SCREEN_ADVANCE_FLOOR}`;
const GATE_POLICY: Record<RoleRunGate, string> = { rejection: SCREEN_POLICY, interview_invite: "invite-1", offer: "offer-1" };

function seedJob(id: string, skills: string[] = ["java"]): void {
  insertJob(
    { id, title: `Role ${id}`, requirements: skills.map((skill) => ({ skill, kind: "skill", hardness: "must" })) } as unknown as JobRecord,
    undefined,
    "published"
  );
}

function seedCandidate(jobId: string, candidateId: string, matchScore: number | null): string {
  return createPipelineEntry({ candidateId, candidateLabel: `Candidate ${candidateId}`, jobId, jobTitle: `Role ${jobId}`, matchScore }).entry.id;
}

function decide(runId: string, branchRef: string, gate: RoleRunGate, decision: "approved" | "declined" = "approved") {
  const now = Date.now();
  return commitRoleRunStageGate({
    runId,
    branchRef,
    gate,
    decision,
    policyVersion: GATE_POLICY[gate],
    subjectRefs: [branchRef],
    token: roleRunGateToken(runId, gate, GATE_POLICY[gate], [branchRef], now),
    approver: "recruiter-1",
    now,
  });
}

/** Every pass result, so direction 1 can hold each report against the rows. A pass's
 *  `awaiting` list is a snapshot, so it is held against the rows the moment it is made —
 *  a later gate commit legitimately moves the branch on. */
async function passes(runId: string, results: AdvanceResult[], maxStages?: number): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    const r = await advanceRoleRun(runId, maxStages ? { maxStages } : {});
    results.push(r);
    const rows = listStageArtifacts(runId);
    for (const { branchRef, gate } of r.awaiting) {
      const kind = GATE_STAGE[gate];
      assert.deepEqual(
        nextStageFor(rows, branchRef),
        { action: "await_gate", kind, approvalKind: STAGE_GATE[kind] },
        `reported parked at ${gate} on ${branchRef}, but the rows say otherwise`
      );
    }
    if (r.produced.length === 0) return;
  }
}

/** Direction 1: nothing a pass reported is a claim the rows cannot back. */
function assertReportsBackedByRows(runId: string, results: AdvanceResult[]): void {
  const rows = listStageArtifacts(runId);
  const produced = results.flatMap((r) => r.produced);
  assert.ok(produced.length > 0, "NON-VACUITY: the run produced something to hold against the rows");
  for (const p of produced) {
    assert.ok(
      rows.some((a) => a.kind === p.kind && a.branchRef === p.branchRef && a.status === p.status),
      `reported ${p.kind}:${p.status} on ${p.branchRef ?? "run-wide"} has no row`
    );
  }
  assert.ok(results.some((r) => r.awaiting.length > 0) || getRoleRun(runId)?.status === "cancelled", "NON-VACUITY: some pass reported a parked branch");

  for (const branchRef of [null, ...new Set(rows.map((a) => a.branchRef).filter((b): b is string => b !== null))]) {
    for (const kind of completedStagesFor(rows, branchRef)) {
      assert.ok(
        rows.some((a) => a.kind === kind && a.status === "complete" && (a.branchRef === branchRef || a.branchRef === null)),
        `${kind} reads complete on ${branchRef ?? "run-wide"} with no complete row behind it`
      );
    }
  }

  if (getRoleRun(runId)?.status === "complete") {
    for (const branchRef of new Set(rows.map((a) => a.branchRef).filter((b): b is string => b !== null))) {
      const next = nextStageFor(rows, branchRef);
      assert.ok(
        next.action === "done" && (next.reason === "branch_terminal" || next.reason === "offer_approved"),
        `the run reads complete while ${branchRef} is still owed ${JSON.stringify(next)}`
      );
    }
  }
}

before(() => ensureDb());
beforeEach(() => resetScreenWaveApprovalSpendForTests());
after(() => cleanupUnitDb());

test("every row a real run writes is reachable, and every report it makes is backed by a row — in every shape a run ends in", async () => {
  seedJob("jd-contract");
  const hired = seedCandidate("jd-contract", "cand-hired", 91);
  const declinedAtInvite = seedCandidate("jd-contract", "cand-invite-declined", 88);
  const held = seedCandidate("jd-contract", "cand-held", 20);
  const declinedAtOffer = seedCandidate("jd-contract", "cand-offer-declined", 95);
  const declinedAtScreen = seedCandidate("jd-contract", "cand-screen-declined", 85);
  const { run } = getOrCreateRoleRun({ jobId: "jd-contract" });
  const results: AdvanceResult[] = [];

  await passes(run.id, results);
  for (const c of [hired, declinedAtInvite, held, declinedAtOffer]) decide(run.id, c, "rejection");
  // A recruiter who declines the screen's proposal ends that candidacy at the first gate.
  decide(run.id, declinedAtScreen, "rejection", "declined");
  await passes(run.id, results);
  decide(run.id, hired, "interview_invite");
  decide(run.id, declinedAtInvite, "interview_invite", "declined");
  decide(run.id, declinedAtOffer, "interview_invite");
  await passes(run.id, results);
  decide(run.id, hired, "offer");
  decide(run.id, declinedAtOffer, "offer", "declined");
  assertReportsBackedByRows(run.id, results);

  // The held candidate (below the floor) was routed `hold`, the recruiter approved that
  // screen, and the branch moved on like any other; it has sat at the invite gate since.
  // Carry it to a declined offer so every branch is terminal and the run completes.
  await passes(run.id, results);
  decide(run.id, held, "interview_invite");
  await passes(run.id, results);
  decide(run.id, held, "offer", "declined");
  await passes(run.id, results);
  assert.equal(getRoleRun(run.id)?.status, "complete", "every branch terminal, so the run is over");

  const rows = listStageArtifacts(run.id);
  assert.deepEqual(findRoleRunTransitionViolations(rows), [], "direction 2: every row is a chain the table allows");
  assertReportsBackedByRows(run.id, results);

  // NON-VACUITY: the ledger this contract was checked over really exercised the table —
  // every kind and every status appears, so "no violations" is not "no rows".
  assert.deepEqual([...new Set(rows.map((a) => a.kind))].sort(), [...ROLE_RUN_STAGES].sort());
  assert.deepEqual([...new Set(rows.map((a) => a.status))].sort(), [...ROLE_RUN_STAGE_STATUSES].sort());
});

test("a cancelled run and a run advanced one artifact per pass both replay as legal chains", async () => {
  const missing = getOrCreateRoleRun({ jobId: "jd-contract-missing" }).run;
  const cancelledResults: AdvanceResult[] = [];
  await passes(missing.id, cancelledResults);
  assert.equal(getRoleRun(missing.id)?.status, "cancelled");
  assert.deepEqual(findRoleRunTransitionViolations(listStageArtifacts(missing.id)), []);
  assertReportsBackedByRows(missing.id, cancelledResults);

  seedJob("jd-contract-slow");
  const a = seedCandidate("jd-contract-slow", "cand-slow-a", 90);
  seedCandidate("jd-contract-slow", "cand-slow-b", 70);
  const slow = getOrCreateRoleRun({ jobId: "jd-contract-slow" }).run;
  const slowResults: AdvanceResult[] = [];
  await passes(slow.id, slowResults, 1);
  decide(slow.id, a, "rejection");
  await passes(slow.id, slowResults, 1);
  assert.ok(slowResults.filter((r) => r.ceilingHit).length > 0, "NON-VACUITY: the ceiling really did interrupt passes");
  assert.deepEqual(findRoleRunTransitionViolations(listStageArtifacts(slow.id)), []);
  assertReportsBackedByRows(slow.id, slowResults);
});

test("a half-finished run is reconstructed from the store with zero in-memory state", async () => {
  seedJob("jd-contract-restart");
  const c = seedCandidate("jd-contract-restart", "cand-restart", 93);
  const { run } = getOrCreateRoleRun({ jobId: "jd-contract-restart" });

  /** A process restart, as far as the ledger can tell: the memoized connection is
   *  closed and dropped, so the next read opens the database file afresh. */
  const restart = () => {
    const holder = globalThis as typeof globalThis & { __kpDb?: { close(): void } };
    holder.__kpDb?.close();
    holder.__kpDb = undefined;
  };

  const predictThenPass = async (branchRef: string | null): Promise<RoleRunStageKind> => {
    restart();
    const predicted = nextStageFor(listStageArtifacts(run.id), branchRef);
    assert.equal(predicted.action, "produce", `expected work to be owed on ${branchRef ?? "run-wide"}`);
    const kind = predicted.action === "produce" ? predicted.kind : ("" as RoleRunStageKind);
    restart();
    const pass = await advanceRoleRun(run.id, { maxStages: 1 });
    assert.deepEqual(
      pass.produced.map((p) => p.kind),
      [kind],
      "the reopened rows alone predicted exactly what the next pass produced"
    );
    return kind;
  };

  assert.equal(await predictThenPass(null), "role_spec");
  assert.equal(await predictThenPass(null), "slate");
  assert.equal(await predictThenPass(c), "screen");

  restart();
  assert.deepEqual(nextStageFor(listStageArtifacts(run.id), c), { action: "await_gate", kind: "screen", approvalKind: "rejection_review" });
  decide(run.id, c, "rejection");

  assert.equal(await predictThenPass(c), "case_assignment");
  assert.equal(await predictThenPass(c), "interview");
  restart();
  assert.deepEqual((await advanceRoleRun(run.id)).produced, [], "parked across a restart is still parked");
});

test("a runner that would skip a gate or end a candidacy on its own is refused, and nothing is written", async () => {
  seedJob("jd-contract-rogue");
  const c = seedCandidate("jd-contract-rogue", "cand-rogue", 92);
  const { run } = getOrCreateRoleRun({ jobId: "jd-contract-rogue" });
  await advanceRoleRun(run.id, { maxStages: 2 }); // role_spec + slate

  const rowsBefore = listStageArtifacts(run.id).length;
  await assert.rejects(
    advanceRoleRun(run.id, {
      runners: {
        // A screen that advances everybody with no human: the rejection gate, skipped.
        screen: (ctx) => ({
          status: "complete",
          payload: { decisions: [{ entryId: ctx.branchRef ?? "", route: "advance", matchScore: 92, reasonCode: "x", reasonParams: {} }], policyVersion: "rogue", fairnessAlerts: [] },
        }),
      },
    }),
    (e: unknown) => e instanceof RoleRunTransitionError && e.from === "slate:complete" && e.to === "screen:complete"
  );
  assert.equal(listStageArtifacts(run.id).length, rowsBefore, "the refused row never landed");
  assert.deepEqual(nextStageFor(listStageArtifacts(run.id), c), { action: "produce", kind: "screen" }, "and the branch is still owed its screen");

  await advanceRoleRun(run.id);
  decide(run.id, c, "rejection");
  const rowsAtCase = listStageArtifacts(run.id).length;
  await assert.rejects(
    advanceRoleRun(run.id, {
      runners: {
        case_assignment: () => ({ status: "terminal", payload: { assignments: [], caseDesignHash: "h" } }),
      },
    }),
    (e: unknown) => e instanceof RoleRunTransitionError && e.to === "case_assignment:terminal"
  );
  assert.equal(listStageArtifacts(run.id).length, rowsAtCase);
  assert.deepEqual(findRoleRunTransitionViolations(listStageArtifacts(run.id)), []);
});

test("a gate commit for a gate the branch is not parked at is refused before the approval is spent", async () => {
  seedJob("jd-contract-wrong-gate");
  const c = seedCandidate("jd-contract-wrong-gate", "cand-wrong-gate", 90);
  const { run } = getOrCreateRoleRun({ jobId: "jd-contract-wrong-gate" });
  await advanceRoleRun(run.id);

  const now = Date.now();
  const token = roleRunGateToken(run.id, "offer", GATE_POLICY.offer, [c], now);
  assert.throws(
    () =>
      commitRoleRunStageGate({ runId: run.id, branchRef: c, gate: "offer", decision: "approved", policyVersion: GATE_POLICY.offer, subjectRefs: [c], token, approver: "recruiter-1", now }),
    /not parked at the offer gate/
  );
  assert.equal(isRoleRunGateSpent(token, now), false, "a refused commit must not burn the recruiter's token");
  assert.deepEqual(nextStageFor(listStageArtifacts(run.id), c), { action: "await_gate", kind: "screen", approvalKind: "rejection_review" });
});
