// S2 producer: the automation pass's scoped dry run, written as a PROPOSAL parked at the
// rejection gate. The pass is an injected stand-in (no Python is spawned); what is real is
// the ledger, the PII door, and the gate commit that resolves the parked artifact.
import "better-sqlite3";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { ensureDb } from "../db/core.ts";
import { advanceRoleRun, commitRoleRunStageGate } from "../role-run-engine.ts";
import { getOrCreateRoleRun, latestBranchArtifact, latestStageArtifact } from "../db/role-runs.ts";
import { insertJob } from "../job-ingest.ts";
import { createPipelineEntry } from "../db/pipeline.ts";
import type { JobRecord } from "../db/core.ts";
import type { ScreenPayload } from "../role-run-stages.ts";
import { roleRunGateToken } from "../role-run-gates.ts";
import { resetScreenWaveApprovalSpendForTests } from "../screen-wave-approval.ts";
import { AutomationPassError, FAIRNESS_BLOCKED_REJECT_ALERT, runAutomationPass, scopeToEntryIds, type AutomationDecision } from "../automation-pass.ts";
import { producerRunners } from "./index.ts";
import { screenProducer, SCREEN_POLICY_VERSION } from "./screen.ts";

before(() => {
  ensureDb();
  for (const id of ["jd-sc-a", "jd-sc-b", "jd-sc-c"]) {
    insertJob({ id, title: "Engineer", requirements: [{ skill: "java", kind: "skill", hardness: "must" }] } as unknown as JobRecord, undefined, "published");
  }
});
after(() => cleanupUnitDb());

const decision = (entryId: string, over: Partial<AutomationDecision>): AutomationDecision => ({
  entryId,
  action: "advance",
  toStage: "Interview",
  alerts: [],
  reason: "Score 82 clears the bar for Jane Novak, advancing",
  ...over,
});
const seed = (jobId: string, candidateId: string) =>
  createPipelineEntry({ candidateId, candidateLabel: `Jane ${candidateId}`, jobId, jobTitle: "Engineer", matchScore: 50 }).entry;
const screenOf = (runId: string, branch: string) => latestBranchArtifact(runId, branch)?.payload as ScreenPayload;

test("a scoped dry-run decision becomes a parked proposal carrying scores and CODES, never the pass's prose", async () => {
  const entry = seed("jd-sc-a", "c-1");
  const { run } = getOrCreateRoleRun({ jobId: "jd-sc-a" });
  let asked: readonly string[] = [];
  const runners = producerRunners(
    [screenProducer({ pass: async (ids) => { asked = ids; return { summary: {} as never, decisions: [decision(entry.id, { matchScore: 82, reasonCode: "queuedForApproval", reasonParams: { score: 82, original: "Score 82 clears the bar for Jane Novak", rule: "fairness.min_evidence" } })] }; } })],
    { llmAvailable: () => false }
  );
  const result = await advanceRoleRun(run.id, { runners });
  assert.deepEqual(asked, [entry.id], "the pass is asked about THIS branch only");
  assert.deepEqual(result.awaiting, [{ branchRef: entry.id, gate: "rejection" }]);
  const payload = screenOf(run.id, entry.id);
  assert.equal(payload.policyVersion, SCREEN_POLICY_VERSION);
  assert.deepEqual(payload.decisions[0], {
    entryId: entry.id,
    route: "advance",
    matchScore: 82,
    reasonCode: "queuedForApproval",
    reasonParams: { score: 82, rule: "fairness.min_evidence" },
  });
  assert.equal(JSON.stringify(payload).includes("Jane"), false);
});

test("a proposed rejection is still just a proposal: the rejection gate resolves it exactly as before", async () => {
  resetScreenWaveApprovalSpendForTests();
  const entry = seed("jd-sc-b", "c-2");
  const { run } = getOrCreateRoleRun({ jobId: "jd-sc-b" });
  const runners = producerRunners(
    [screenProducer({ pass: async () => ({ summary: {} as never, decisions: [decision(entry.id, { action: "reject", toStage: null, matchScore: 31, alerts: [FAIRNESS_BLOCKED_REJECT_ALERT] })] }) })],
    { llmAvailable: () => false }
  );
  await advanceRoleRun(run.id, { runners });
  const parked = screenOf(run.id, entry.id);
  assert.equal(parked.decisions[0].route, "reject_proposed");
  assert.deepEqual(parked.fairnessAlerts, [FAIRNESS_BLOCKED_REJECT_ALERT]);
  assert.equal(latestBranchArtifact(run.id, entry.id)?.status, "awaiting_approval", "nothing was applied");

  const now = Date.now();
  const policy = parked.policyVersion;
  const token = roleRunGateToken(run.id, "rejection", policy, [entry.id], now);
  const resolved = commitRoleRunStageGate({ runId: run.id, branchRef: entry.id, gate: "rejection", decision: "approved", policyVersion: policy, subjectRefs: [entry.id], token, approver: "recruiter-1", now });
  assert.equal(resolved.status, "terminal");
});

test("no decision for the branch (not active): the keyless floor answers", async () => {
  const entry = seed("jd-sc-c", "c-3");
  const { run } = getOrCreateRoleRun({ jobId: "jd-sc-c" });
  await advanceRoleRun(run.id, { runners: producerRunners([screenProducer({ pass: async () => ({ summary: {} as never, decisions: [] }) })], { llmAvailable: () => false }) });
  assert.match(screenOf(run.id, entry.id).policyVersion, /^screen-1@/);
  assert.ok(latestStageArtifact(run.id, "slate", null));
});

test("scopeToEntryIds narrows to the named entries and passes everything through when unscoped", () => {
  const es = [{ id: "a" }, { id: "b" }, { id: "c" }] as Parameters<typeof scopeToEntryIds>[0];
  assert.deepEqual(scopeToEntryIds(es, ["b", "zzz"]).map((e) => e.id), ["b"]);
  assert.equal(scopeToEntryIds(es), es);
});

test("a scoped pass is dry-run only: asking to APPLY a subset of the board is refused", () => {
  assert.throws(() => runAutomationPass({ entryIds: ["a"] }), (e: unknown) => e instanceof AutomationPassError && e.status === 400);
});
