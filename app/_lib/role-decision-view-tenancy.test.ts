// CX S45 - the role decision view is workspace-scoped end to end on a real SQLite file:
// another team's entries on the same job id never appear, and an entry whose submission
// link names another team's submission reads that work sample as absent - never its score.
//
// IMPORT ORDER IS LOAD-BEARING: unit-db sets KP_DB_PATH before the db modules load.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPipelineEntry, createPosting, createSubmission, saveSubmissionEvaluation } from "./db.ts";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";
import { loadRoleDecisionView } from "./role-decision-view-server.ts";

after(() => cleanupUnitDb());

const WS_B = "team-role-view-b";
const JOB = "role-view-shared-job";

function defaultSubmission(score: number): string {
  const posting = createPosting({ caseId: "case-role-view", channel: "local", token: "tok-role-view", roleTitle: "Ops", caseTitle: "Case" });
  const { submission } = createSubmission({ postingId: posting.id, candidateRef: "Default Dana", repoRef: "repo-role-view" });
  saveSubmissionEvaluation(submission.id, { source: "llm", evaluation: { summary: "ok" } }, score);
  return submission.id;
}

test("another workspace's entries on the same job never appear", () => {
  createPipelineEntry({ candidateId: "rv-a", candidateLabel: "Default Dana", jobId: JOB, jobTitle: "Ops", workspaceId: DEFAULT_WORKSPACE_ID });
  createPipelineEntry({ candidateId: "rv-b", candidateLabel: "Team B Ben", jobId: JOB, jobTitle: "Ops", workspaceId: WS_B });
  assert.deepEqual(loadRoleDecisionView(JOB, WS_B).candidates.map((c) => c.candidateLabel), ["Team B Ben"]);
  assert.deepEqual(loadRoleDecisionView(JOB, DEFAULT_WORKSPACE_ID).candidates.map((c) => c.candidateLabel), ["Default Dana"]);
});

test("a submission owned by another workspace is absent, its score never read", () => {
  const subId = defaultSubmission(88);
  const { entry } = createPipelineEntry({
    candidateId: "rv-c",
    candidateLabel: "Team B Cleo",
    jobId: "role-view-job-2",
    jobTitle: "Ops",
    devSubmissionId: subId,
    workspaceId: WS_B,
  });
  const [c] = loadRoleDecisionView("role-view-job-2", WS_B).candidates;
  assert.equal(c.entryId, entry.id);
  assert.equal(c.workSample.transferScore, null);
  assert.equal(c.workSample.reason, "not_submitted");

  const { entry: own } = createPipelineEntry({
    candidateId: "rv-d",
    candidateLabel: "Default Dora",
    jobId: "role-view-job-3",
    jobTitle: "Ops",
    devSubmissionId: subId,
    workspaceId: DEFAULT_WORKSPACE_ID,
  });
  const [mine] = loadRoleDecisionView("role-view-job-3", DEFAULT_WORKSPACE_ID).candidates;
  assert.equal(mine.entryId, own.id);
  assert.equal(mine.workSample.transferScore, 88, "the owning team reads its own score");
  assert.equal(mine.workSample.grading, "graded");
});

test("the route passes the session workspace and sits behind the operator gate", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, "..", "api", "decisions", "role-view", "route.ts"), "utf8");
  assert.match(src, /route\(withOperator\)\(async \(ws: string/);
  assert.match(src, /loadRoleDecisionView\(jobId, ws\)/);
});
