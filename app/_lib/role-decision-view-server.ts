// CX S45 - the store side of the role decision view (role-decision-view.ts is the pure
// half). Every read is scoped to the caller's workspace:
//
//   pipeline_entries      listEntriesForJob(jobId, ws)                 workspace predicate
//   match score           withCanonicalScores(entries, ws)             workspace-scoped fits
//   dev_submissions       getSubmission(id) + workspaceId === ws       by-id, then OWNED check:
//                                                                      a foreign team's id reads as absent
//   debrief / hold        readDebriefFindings / heldForAuthorship /    sealed records under the
//                         clearedByFor (the submission's workspace)    submission's (= ws) workspace
//   interview scorecards  getHumanScorecards(entryId, ws)              workspace predicate
//   AI interview          latestInterviewByEntry(entryId, ws)          workspace predicate
//
// Only ACTIVE entries get the per-entry reads (see activeForDecision), capped so a role
// with a very long tail cannot turn one request into thousands of point reads.

import { getSubmission } from "./db/devcase";
import { latestInterviewByEntry } from "./db/interviews";
import { listEntriesForJob } from "./db/pipeline";
import { clearedByFor, heldForAuthorship, readDebriefFindings } from "./devcase-debrief-findings";
import { devCaseIdForEntry, submissionIdForEntry } from "./devcase-identity";
import { RATING_MAX } from "./format";
import { getHumanScorecards } from "./interview-prep";
import { withCanonicalScores } from "./match-score-resolve";
import { getPipelineAxis } from "./pipeline-axis-server";
import {
  activeForDecision,
  assembleRoleDecisionView,
  type RoleDecisionView,
  type RoleViewFacts,
  type RoleViewSubmissionInput,
} from "./role-decision-view";

/** The most active candidates one view carries. */
export const ROLE_VIEW_CAP = 200;

function ownedSubmission(id: string | null, ws: string): RoleViewSubmissionInput | null {
  if (!id) return null;
  const sub = getSubmission(id);
  if (!sub || sub.workspaceId !== ws) return null;
  return {
    transferScore: sub.transferScore,
    evaluation: sub.evaluation ?? null,
    debrief: { ...readDebriefFindings(sub), held: heldForAuthorship(sub), clearedBy: clearedByFor(sub) },
  };
}

function aiScorecardOf(entryId: string, ws: string): RoleViewFacts["aiScorecard"] {
  const sc = latestInterviewByEntry(entryId, ws)?.scorecard;
  return sc && typeof sc === "object" && !Array.isArray(sc) ? (sc as RoleViewFacts["aiScorecard"]) : null;
}

export function loadRoleDecisionView(jobId: string, ws: string): RoleDecisionView {
  const terminal = new Set(getPipelineAxis(ws).stages.filter((s) => s.role === "terminal").map((s) => s.id));
  const active = listEntriesForJob(jobId, ws)
    .filter((e) => activeForDecision(e, terminal))
    .slice(0, ROLE_VIEW_CAP);
  const scored = withCanonicalScores(active, ws);
  const facts: RoleViewFacts[] = scored.map((e) => {
    const submissionId = submissionIdForEntry(e);
    return {
      entry: {
        id: e.id,
        candidateLabel: e.candidateLabel,
        stage: e.stage,
        status: e.status,
        canonicalScore: e.canonicalScore,
        scoreProvenance: e.scoreProvenance,
        caseId: devCaseIdForEntry(e),
        submissionId,
      },
      submission: ownedSubmission(submissionId, ws),
      humanScorecards: getHumanScorecards(e.id, ws),
      aiScorecard: aiScorecardOf(e.id, ws),
    };
  });
  return assembleRoleDecisionView(jobId, facts, terminal, RATING_MAX);
}
