// Finding gsim #1 — /api/sim/apply-cv must NEVER file a SIMULATED CV into the job
// OWNER's real pipeline. Pre-fix the route derived the write target from
// getJobWorkspace(job) (the owner's team) and stamped the real, UNMARKED title, so a
// keyless demo CV became a permanent, analytics-counted, un-purgeable REAL entry in
// someone else's workspace.
//
// MULTI-WORKSPACE UPDATE: the original fix pinned the target to DEFAULT_WORKSPACE_ID.
// That satisfied gsim #1 by accident of there being only one tenant — and once
// KP_MULTI_WORKSPACE was on it became its own bug: a team pressed "Simulate inbound",
// the row landed on the DEFAULT team's board, the walk then read its own correctly
// scoped pipeline, found nothing, and halted. simCvIntakeTarget now takes the CALLER'S
// team explicitly. gsim #1 still holds — the caller is not the job owner — and it now
// holds for the RIGHT reason rather than by single-tenancy.
//
// This pins the three guarantees:
//   (1) simCvIntakeTarget returns the CALLER's workspace, never the job owner's, and
//       always marks the stored title (the write-scoping decision the route makes);
//   (2) a so-scoped entry leaves NO row in the owner's workspace and is FULLY
//       purged by resetSim();
//   (3) it never enters the real hire-rate / funnel in EITHER workspace.
//
// Real, throwaway DB: testing/unit-db.ts must stay the FIRST project import (it
// owns the mkdtempSync temp dir — no ${process.pid} paths).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { simCvIntakeTarget } from "./cv-intake.ts";
import { markSimTitle, isSimTitle } from "@/app/features/shell/simulation/constants";
import { getJob, getJobWorkspace, createPipelineEntry, DEFAULT_WORKSPACE_ID } from "./db.ts";
import { insertJob } from "./job-ingest.ts";
import { pipelineAnalytics } from "./db/analytics.ts";
import { resetSim } from "./sim-store.ts";
import { ensureDb } from "./db/core.ts";

after(() => cleanupUnitDb());

const OWNER_WS = "team-real-owner"; // a REAL team that owns the tested opening
const CALLER_WS = "team-running-the-demo"; // the team actually pressing the button
const REAL_TITLE = "Staff Platform Engineer";

test("a simulated CV never lands in the job owner's workspace, is purged by resetSim, and never counts in the real hire-rate", () => {
  // A real opening owned by ANOTHER team (workspace_id = OWNER_WS).
  insertJob({ id: "sim-scope-job", title: REAL_TITLE }, undefined, "published", OWNER_WS);
  const job = getJob("sim-scope-job");
  assert.ok(job, "precondition: the opening exists");
  assert.equal(getJobWorkspace(job.id), OWNER_WS, "precondition: the opening is owned by the real team");

  // (1) The write-scoping decision the route makes: sim writes target the CALLER'S
  //     own team with a `(SIM)`-marked title — NOT the owner's team, NOT the real,
  //     unmarked title. The caller's team is what makes the demo visible to the
  //     person running it; the marker is what keeps it purgeable and out of metrics.
  const target = simCvIntakeTarget(job, CALLER_WS);
  assert.equal(target.workspaceId, CALLER_WS, "sim CV is scoped to the team running the demo");
  assert.notEqual(target.workspaceId, getJobWorkspace(job.id), "sim CV must NOT be scoped to the job owner's workspace");
  assert.notEqual(target.workspaceId, DEFAULT_WORKSPACE_ID, "nor silently to the default team, which is what stranded it");
  assert.ok(isSimTitle(target.jobTitle), "the stored title carries the (SIM) marker so it's purgeable + analytics-excluded");
  assert.equal(target.jobTitle, markSimTitle(REAL_TITLE));

  // Snapshot the REAL hire-rate of BOTH workspaces before the sim write.
  const ownerBefore = pipelineAnalytics(null, undefined, OWNER_WS);
  const demoBefore = pipelineAnalytics(null, undefined, CALLER_WS);

  // File the sim CV exactly the way the fixed route does (createPipelineEntry with
  // the sim target) — at "Hired", the worst case for hire-rate corruption.
  const { entry } = createPipelineEntry({
    candidateId: "sim-scope-cand",
    candidateLabel: "Demo CV Applicant",
    jobId: job.id,
    jobTitle: target.jobTitle,
    stage: "Hired",
    workspaceId: target.workspaceId,
    sourceChannel: "email",
  });

  // (2a) No row landed in the job owner's real workspace.
  const ownerRows = ensureDb()
    .prepare(`SELECT COUNT(*) AS c FROM pipeline_entries WHERE workspace_id = ?`)
    .get(OWNER_WS) as { c: number };
  assert.equal(ownerRows.c, 0, "the job owner's pipeline gains NO row from a sim CV");
  // ...it landed in the demo workspace instead, visibly marked.
  const demoRow = ensureDb()
    .prepare(`SELECT job_title, workspace_id FROM pipeline_entries WHERE id = ?`)
    .get(entry.id) as { job_title: string; workspace_id: string };
  assert.equal(demoRow.workspace_id, CALLER_WS);
  assert.ok(isSimTitle(demoRow.job_title));

  // (3) The sim "hire" never moves the REAL hire-rate/funnel in EITHER workspace.
  const ownerAfter = pipelineAnalytics(null, undefined, OWNER_WS);
  const demoAfter = pipelineAnalytics(null, undefined, CALLER_WS);
  assert.equal(ownerAfter.total, ownerBefore.total, "owner workspace applicant count unchanged");
  assert.equal(ownerAfter.hired, ownerBefore.hired, "owner workspace hire count unchanged");
  assert.equal(demoAfter.total, demoBefore.total, "the running team's real applicant count is unchanged (sim row excluded by marker)");
  assert.equal(demoAfter.hired, demoBefore.hired, "the demo 'hire' never counts as a real hire");

  // (2b) resetSim(), scoped to the same team, fully purges it. Scoping matters:
  //       a default-workspace purge would have left this row behind forever.
  const cleared = resetSim(CALLER_WS);
  assert.ok(cleared.entries >= 1, "resetSim reports purging the sim entry");
  const gone = ensureDb().prepare(`SELECT COUNT(*) AS c FROM pipeline_entries WHERE id = ?`).get(entry.id) as { c: number };
  assert.equal(gone.c, 0, "the sim entry is gone after resetSim — no unpurgeable residue");
});
