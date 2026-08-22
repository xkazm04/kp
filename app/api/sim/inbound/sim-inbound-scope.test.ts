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
import { setDecisionConfig } from "@/app/_lib/decision-config-store";
import { getPipelineAxis } from "@/app/_lib/pipeline-axis-server";
import { knownStageIds } from "@/app/_lib/pipeline-axis";
import { stageWithRole } from "@/app/_lib/pipeline-stages";
import { isSimTitle } from "@/app/features/shell/simulation/constants";

after(() => cleanupUnitDb());

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "route.ts"), "utf8");

test("the sim inbound route derives its write target from simCvIntakeTarget", () => {
  assert.match(src, /import \{ simCvIntakeTarget \}/, "the shared sim-scoping helper is the source of truth");
  // The helper takes the CALLER'S team explicitly. It used to be single-argument and
  // pinned internally to the default workspace, which stranded every other team's demo
  // on a board they could not see; requiring the second argument here is what stops
  // that from being reintroduced.
  assert.match(
    src,
    /simCvIntakeTarget\(job, await currentWorkspace\(\)\)/,
    "the target is derived from the real job AND the caller's own workspace"
  );
});

test("the applicant is filed at the board's ENTRY column, resolved by role", () => {
  // The literal `stage: "Accepted"` is only that column's NAME on the shipped axis.
  // Settings → Hiring composes the axis per workspace (free-form stage ids), and
  // createPipelineEntry validates nothing, so the literal filed the demo applicant
  // onto a column the board does not render. Same seam as /api/apply/[id] and
  // cv-intake.ts, pinned the same way (cf. apply-intake-scope.test.ts).
  assert.match(src, /import \{ getPipelineAxis \}/, "the axis must be read for the write target's workspace");
  assert.match(
    src,
    /stage: stageWithRole\("entry", getPipelineAxis\(target\.workspaceId\)\.stages\) \?\? "Accepted"/,
    "the entry column is resolved by ROLE from the target workspace's own axis"
  );
  assert.doesNotMatch(src, /stage: "Accepted"/, "the shipped column NAME must never be written as a literal");
});

test("on a workspace that composed its own axis, the literal 'Accepted' is off-axis and the role-resolved column is not", () => {
  // The behavioural half of the guard above: build the exact axis a team gets when
  // it renames its first column, then show what each of the two write targets does.
  const WS = "team-composed-axis";
  setDecisionConfig(
    "pipelineStages",
    {
      stages: [
        { id: "Triage", label: "Triage", role: "entry" },
        { id: "Screened", label: "Screened", role: "screening" },
        { id: "Interview", label: "Interview", role: "interview" },
        { id: "Offer", label: "Offer", role: "offer" },
        { id: "Hired", label: "Hired", role: "terminal" },
      ],
      retired: [],
    },
    WS
  );

  const axis = getPipelineAxis(WS);
  const known = knownStageIds(axis);
  const resolved = stageWithRole("entry", axis.stages) ?? "Accepted";

  assert.equal(resolved, "Triage", "the entry ROLE resolves to this board's own first column");
  assert.equal(known.has("Accepted"), false, "the shipped column name is NOT a column this board has");
  assert.equal(known.has(resolved), true, "the role-resolved column IS one this board renders");

  // Both writes succeed at the DB layer — that is the point: nothing rejects an
  // off-axis stage, so a literal leaves a permanently stranded row.
  const stranded = createPipelineEntry({
    candidateId: "sim-offaxis-cand",
    candidateLabel: "Stranded Applicant",
    jobId: "sim-offaxis-job",
    jobTitle: "Backend Engineer (SIM)",
    workspaceId: WS,
    stage: "Accepted",
  });
  const filed = createPipelineEntry({
    candidateId: "sim-onaxis-cand",
    candidateLabel: "Filed Applicant",
    jobId: "sim-offaxis-job",
    jobTitle: "Backend Engineer (SIM)",
    workspaceId: WS,
    stage: resolved,
  });
  assert.equal(known.has(stranded.entry.stage), false, "the literal write lands on no column of this board");
  assert.equal(known.has(filed.entry.stage), true, "the role-resolved write lands on a real column");

  // And the read side the Channels tab uses (stage ROLE, see countWaitingAtEntry)
  // only ever sees the second one — the "Waiting" stat that never moved.
  const waiting = ensureDb()
    .prepare(`SELECT COUNT(*) AS c FROM pipeline_entries WHERE workspace_id = ? AND stage = ?`)
    .get(WS, resolved) as { c: number };
  assert.equal(waiting.c, 1, "exactly the role-resolved arrival is waiting at the entry column");
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

  // The CALLER'S team, not the default one: pinning this to DEFAULT satisfied the
  // "never the job owner" rule only while there was a single tenant, and once
  // multi-workspace was on it stranded every other team's demo on the default board.
  const CALLER_WS = "team-running-the-demo";
  const target = simCvIntakeTarget(job, CALLER_WS);
  assert.equal(target.workspaceId, CALLER_WS);
  assert.notEqual(target.workspaceId, OWNER_WS, "a demo applicant never lands in the job owner's pipeline");
  assert.notEqual(target.workspaceId, DEFAULT_WORKSPACE_ID, "nor on the default team, invisible to whoever ran it");
  assert.ok(isSimTitle(target.jobTitle));

  const ownerBefore = pipelineAnalytics(null, undefined, OWNER_WS);
  const demoBefore = pipelineAnalytics(null, undefined, CALLER_WS);

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
  const demoAfter = pipelineAnalytics(null, undefined, CALLER_WS);
  assert.equal(ownerAfter.total, ownerBefore.total, "owner workspace applicant count unchanged");
  assert.equal(demoAfter.total, demoBefore.total, "the demo applicant is excluded from the real funnel by its marker");

  // Scoped to the same team the write targeted — a default-workspace purge would
  // have left this row behind forever.
  const cleared = resetSim(CALLER_WS);
  assert.ok(cleared.entries >= 1, "resetSim reports purging the sim entry");
  const gone = ensureDb().prepare(`SELECT COUNT(*) AS c FROM pipeline_entries WHERE id = ?`).get(entry.id) as { c: number };
  assert.equal(gone.c, 0, "no unpurgeable residue after resetSim");
});
