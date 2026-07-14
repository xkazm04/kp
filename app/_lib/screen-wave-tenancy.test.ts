// Tenant scope (E0 Phase 1 / Direction 1) — the screening wave runs on the CALLER's
// team, not the default workspace. Before the threading, listPipeline() inside the
// wave read the default team's Screened cohort regardless of who invoked it, so a
// non-default team would rank/reject/seal the WRONG cohort (and a default-team wave
// could reach across into another team's candidates). These behavioral tests pin the
// per-tenant boundary against an ISOLATED throwaway DB (unit-db.ts stays the first
// project import).
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createPipelineEntry, getPipelineEntry } from "./db/pipeline.ts";
import { runScreenWave } from "./screen-wave.ts";
import { listDecisionRecords, verifyDecisionChain } from "./decision-record-store.ts";

after(() => cleanupUnitDb());

let seq = 0;
/** Seed one Screened entry in a specific workspace (default when omitted). archetype
 *  "bau" is known + NOT fairness-protected, so only tenancy — not the archetype
 *  shield — decides whether the wave can see/reject it. */
function seed(jobId: string, label: string, matchScore: number | null, workspaceId?: string) {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `swt-c${seq}`,
    candidateLabel: label,
    jobId,
    jobTitle: "Screen Wave Tenancy Role",
    stage: "Screened",
    matchScore,
    archetype: "bau",
    contact: `swt-c${seq}@example.com`,
    workspaceId,
  });
  return entry;
}

const AGGRESSIVE = { autoRejectEnabled: true, rejectBottomPercent: 100, maxMatchToReject: 100 };

test("a foreign-workspace cohort is invisible to the wave — it ranks only the caller's team", async () => {
  const jobId = "swt-job-shared";
  // Same job id filed under two different teams. The default team has a low scorer
  // the aggressive policy would reject; team-a has its own.
  const defaultLow = seed(jobId, "Default Low", 10); // default workspace
  const teamALow = seed(jobId, "Team A Low", 12, "team-a");

  // Run the wave for team-a: it must see ONLY team-a's cohort.
  const teamAWave = await runScreenWave(jobId, AGGRESSIVE, { dryRun: true }, "team-a");
  assert.equal(teamAWave.cohort, 1, "team-a's wave sees only team-a's Screened entry");
  assert.deepEqual(
    teamAWave.decisions.map((d) => d.entryId),
    [teamALow.id],
    "the default team's candidate never enters team-a's wave"
  );

  // And the default team's wave sees only the default cohort — never team-a's.
  const defaultWave = await runScreenWave(jobId, AGGRESSIVE, { dryRun: true });
  assert.equal(defaultWave.cohort, 1);
  assert.deepEqual(defaultWave.decisions.map((d) => d.entryId), [defaultLow.id]);
});

test("a committed wave in a non-default workspace rejects THAT team's cohort and seals onto its own chain", async () => {
  const jobId = "swt-job-commit";
  const teamALow = seed(jobId, "TA Commit Low", 12, "team-a");
  // A default-team entry the wave must NOT touch even though it shares the job id.
  const defaultUntouched = seed(jobId, "Default Untouched", 8);

  const preview = await runScreenWave(jobId, AGGRESSIVE, { dryRun: true }, "team-a");
  assert.deepEqual(preview.decisions.map((d) => d.entryId), [teamALow.id]);

  const committed = await runScreenWave(
    jobId,
    AGGRESSIVE,
    { dryRun: false, approval: { approvedBy: "Team A Approver", token: preview.approvalToken } },
    "team-a"
  );
  assert.equal(committed.rejected, 1, "the commit lands (workspace-scoped act found the row)");

  // team-a's candidate is rejected; the default team's shared-job candidate is untouched.
  assert.equal(getPipelineEntry(teamALow.id, "team-a")!.status, "rejected");
  assert.equal(getPipelineEntry(defaultUntouched.id)!.status, "active");

  // The seal lands on TEAM-A's chain, not the default one.
  const teamARecords = listDecisionRecords({ candidateRef: teamALow.id, workspaceId: "team-a" });
  assert.equal(teamARecords.length, 1);
  assert.equal(teamARecords[0].kind, "auto_rejected");
  // The default chain never sees this record — even by the same ref.
  assert.equal(
    listDecisionRecords({ candidateRef: teamALow.id }).length,
    0,
    "the auto-rejection is absent from the default team's chain"
  );
  assert.ok(verifyDecisionChain("team-a").ok, "team-a's chain verifies independently");
});
