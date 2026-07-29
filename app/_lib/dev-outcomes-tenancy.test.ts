// D5 — tenant isolation for the dev-studio outcome/calibration corpus.
//
// dev_outcomes had NO workspace column at all, so two teams' hire/reject ground truth
// pooled into one corpus and calibrate() handed a recruiter a promote-floor recommendation
// computed from another team's hiring reality. The table is now workspace-scoped and
// reclassified SCOPED in the tenancy manifest.
//
// BEHAVIORAL, not a SQL grep: two workspaces write outcomes that would collide on `ref`
// and on (candidateRef, outcome), and each read — list, per-ref join, calibration — must
// see only its own. A source guard cannot catch a caller passing the wrong workspace,
// which was the actual defect at the route layer.
//
// unit-db.ts MUST be the first project import (sets KP_DB_PATH before any store resolves).
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";

const { recordOutcome, recordPipelineOutcome, listOutcomes, latestOutcomeByRefs, calibrate } = await import("./dev-outcomes.ts");
const { saveDevCase, createPosting, createSubmission } = await import("./db/devcase.ts");
const { DEFAULT_WORKSPACE_ID } = await import("./db/workspaces.ts");

after(() => cleanupUnitDb());

const A = "ws-outcome-a";
const B = "ws-outcome-b";
// Fresh pair for the calibration case: this file shares one DB across tests, and the
// corpus is cumulative by design (calibrate reads every row of the workspace).
const C = "ws-outcome-c";
const D = "ws-outcome-d";

test("outcomes list + per-ref join isolate by workspace (a shared ref never crosses teams)", () => {
  // Same ref, same candidate name, OPPOSITE outcomes — the worst case for pooling.
  recordOutcome({ ref: "shared-ref", candidateRef: "Alex", predictedScore: 90, outcome: "hired", performance: 5 }, A);
  recordOutcome({ ref: "shared-ref", candidateRef: "Alex", predictedScore: 40, outcome: "rejected" }, B);

  const listA = listOutcomes(50, A);
  const listB = listOutcomes(50, B);
  assert.equal(listA.length, 1, "team A sees exactly its own row");
  assert.equal(listB.length, 1, "team B sees exactly its own row");
  assert.equal(listA[0].outcome, "hired");
  assert.equal(listB[0].outcome, "rejected");

  // The postings-GET join: team B must never read team A's hire for the same submission id.
  assert.equal(latestOutcomeByRefs(["shared-ref"], A).get("shared-ref")?.outcome, "hired");
  assert.equal(latestOutcomeByRefs(["shared-ref"], B).get("shared-ref")?.outcome, "rejected");
  // A third tenant (the default) sees nothing at all.
  assert.equal(latestOutcomeByRefs(["shared-ref"], DEFAULT_WORKSPACE_ID).size, 0);
  assert.equal(listOutcomes(50, DEFAULT_WORKSPACE_ID).length, 0, "the default tenant's corpus is untouched by either team");
});

test("the refless (candidateRef, outcome) upsert key never merges two teams' rows", () => {
  recordOutcome({ candidateRef: "Robin", outcome: "hired", predictedScore: 88 }, A);
  // Same name, same outcome, same score in another team: pre-D5 this UPDATED team A's row.
  assert.equal(recordOutcome({ candidateRef: "Robin", outcome: "hired", predictedScore: 88 }, B), "inserted");
  // ...and within a team it still completes the existing row rather than duplicating it.
  assert.equal(recordOutcome({ candidateRef: "Robin", outcome: "hired", performance: 4 }, B), "updated");
  assert.equal(listOutcomes(50, A).filter((o) => o.candidateRef === "Robin").length, 1);
  assert.equal(listOutcomes(50, B).filter((o) => o.candidateRef === "Robin").length, 1);
  assert.equal(listOutcomes(50, A).find((o) => o.candidateRef === "Robin")?.performance, null, "team B's perf score stayed in team B");
});

test("calibration is computed from the caller's corpus only (the promote-floor advice is per-team)", () => {
  // Team A: strong scores convert, weak ones don't → a clean, predictive picture.
  for (const [ref, score, outcome] of [
    ["a1", 90, "hired"],
    ["a2", 88, "hired"],
    ["a3", 60, "rejected"],
    ["a4", 50, "rejected"],
  ] as const) {
    recordOutcome({ ref, predictedScore: score, outcome }, C);
  }
  // Team B: nothing decided at all.
  recordOutcome({ ref: "b1", predictedScore: 95, outcome: "pending" }, D);

  const calA = calibrate(55, C);
  assert.equal(calA.resolved, 4, "team A calibrates off its own four decided outcomes");
  assert.equal(calA.suggestedFloor, 85);

  const calB = calibrate(55, D);
  assert.equal(calB.resolved, 0, "team B has no decided outcomes — no recommendation is made");
  assert.equal(calB.suggestedFloor, null, "team B must NOT inherit team A's floor suggestion");
});

test("the pipeline auto-record derives its tenant from the submission the ref names", () => {
  // A promoted submission owned by team A; the pipeline entry that mirrors it carries no
  // workspace of its own (PipelineEntry has no workspaceId), so the store derives it.
  const devCase = saveDevCase({ need: {}, analysis: {}, role: { title: "R" }, case: { title: "C" } }, A);
  const posting = createPosting({ caseId: devCase.id, channel: "direct", token: "tok-outcome-a", roleTitle: "R", caseTitle: "C" });
  const { submission } = createSubmission({ postingId: posting.id, candidateRef: "Sam", repoRef: "https://example.test/sam" });

  assert.equal(
    recordPipelineOutcome({ candidateId: `ds-${submission.id}`, candidateLabel: "Sam", matchScore: 77 }, "hired"),
    true
  );
  assert.ok(listOutcomes(50, A).some((o) => o.ref === submission.id), "the auto-record landed in the submission's own workspace");
  assert.equal(
    listOutcomes(50, DEFAULT_WORKSPACE_ID).some((o) => o.ref === submission.id),
    false,
    "and NOT in the default tenant's calibration corpus"
  );
  // Idempotence still holds within that derived tenant.
  assert.equal(
    recordPipelineOutcome({ candidateId: `ds-${submission.id}`, candidateLabel: "Sam", matchScore: 77 }, "hired"),
    false
  );
});
