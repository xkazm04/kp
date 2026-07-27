// comms-tenancy-pair (b) — /api/sim/inbound was the one UN-tenanted sim write. It
// reads no session, so listPipeline/createPipelineEntry silently defaulted to
// DEFAULT_WORKSPACE_ID and it stamped the REAL, unmarked job title — so the "Receive a
// test application" button on the Channels tab reported success into a board the
// recruiter may not be looking at, and left a permanent, analytics-counted,
// un-purgeable row behind. Its sibling /api/sim/apply-cv makes the scoping decision
// explicitly through simCvIntakeTarget (pinned by cv-intake-sim-scope.test.ts); this
// pins that the inbound sim now makes the SAME decision through the SAME helper.
//
// Two halves:
//   (1) SOURCE GUARD (repo pattern, cf. channels-tenancy.test.ts) — the route file
//       actually threads the sim target into BOTH the read and the write, and no bare
//       `listPipeline()` / real-title write survives a refactor.
//   (2) BEHAVIOUR — a row written the way the route now writes it lands in the demo
//       workspace (never the job owner's), stays out of the real funnel, and is fully
//       purged by resetSim.
//
// Real, throwaway DB: testing/unit-db.ts must stay the FIRST project import.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cleanupUnitDb } from "@/app/_lib/testing/unit-db";
import { simCvIntakeTarget } from "@/app/_lib/cv-intake";
import { createPipelineEntry, getJob, getJobWorkspace, DEFAULT_WORKSPACE_ID } from "@/app/_lib/db";
import { insertJob } from "@/app/_lib/job-ingest";
import { pipelineAnalytics } from "@/app/_lib/db/analytics";
import { resetSim } from "@/app/_lib/sim-store";
import { ensureDb } from "@/app/_lib/db/core";
import { isSimTitle } from "@/app/features/simulation/constants";

after(() => cleanupUnitDb());

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "route.ts"), "utf8");

test("the sim inbound route derives its write target from simCvIntakeTarget", () => {
  assert.match(src, /import \{ simCvIntakeTarget \}/, "the shared sim-scoping helper is the source of truth");
  assert.match(src, /simCvIntakeTarget\(job\)/, "the target is derived from the real job");
});

test("both the dedupe READ and the entry WRITE are scoped to the sim workspace", () => {
  assert.match(src, /listPipeline\(target\.workspaceId\)/, "the dedupe read looks at the board we write into");
  assert.doesNotMatch(src, /listPipeline\(\)/, "no un-scoped pipeline read may return");
  assert.match(src, /workspaceId: target\.workspaceId/, "the entry is stamped with the sim workspace");
  assert.match(src, /jobTitle: target\.jobTitle/, "the stored title carries the (SIM) marker");
  assert.doesNotMatch(src, /jobTitle: job\.title/, "the REAL, unmarked title must never be stored by a sim write");
});

test("a sim-inbound entry lands in the demo workspace, stays out of the real funnel, and is purged", () => {
  const OWNER_WS = "team-inbound-owner";
  insertJob({ id: "sim-inbound-job", title: "Site Reliability Engineer" }, undefined, "published", OWNER_WS);
  const job = getJob("sim-inbound-job");
  assert.ok(job, "precondition: the opening exists");
  assert.equal(getJobWorkspace(job.id), OWNER_WS, "precondition: another team owns the opening");

  const target = simCvIntakeTarget(job);
  assert.equal(target.workspaceId, DEFAULT_WORKSPACE_ID);
  assert.notEqual(target.workspaceId, OWNER_WS, "a demo applicant never lands in the job owner's pipeline");
  assert.ok(isSimTitle(target.jobTitle));

  const ownerBefore = pipelineAnalytics(null, undefined, OWNER_WS);
  const demoBefore = pipelineAnalytics();

  // Exactly the write the fixed route makes.
  const { entry } = createPipelineEntry({
    candidateId: "sim-inbound-cand",
    candidateLabel: "Demo Inbound Applicant",
    jobId: job.id,
    jobTitle: target.jobTitle,
    workspaceId: target.workspaceId,
    matchScore: 71,
    stage: "Accepted",
  });

  const ownerRows = ensureDb()
    .prepare(`SELECT COUNT(*) AS c FROM pipeline_entries WHERE workspace_id = ?`)
    .get(OWNER_WS) as { c: number };
  assert.equal(ownerRows.c, 0, "the job owner's pipeline gains NO row from a sim inbound");

  const ownerAfter = pipelineAnalytics(null, undefined, OWNER_WS);
  const demoAfter = pipelineAnalytics();
  assert.equal(ownerAfter.total, ownerBefore.total, "owner workspace applicant count unchanged");
  assert.equal(demoAfter.total, demoBefore.total, "the demo applicant is excluded from the real funnel by its marker");

  const cleared = resetSim();
  assert.ok(cleared.entries >= 1, "resetSim reports purging the sim entry");
  const gone = ensureDb().prepare(`SELECT COUNT(*) AS c FROM pipeline_entries WHERE id = ?`).get(entry.id) as { c: number };
  assert.equal(gone.c, 0, "no unpurgeable residue after resetSim");
});
