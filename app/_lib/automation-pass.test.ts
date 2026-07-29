// Pins the PREVIEW/COMMIT PARITY contract of the automation policy pass: the
// dry-run preview must forecast exactly the outcome the commit produces.
//
// The defect this locks out: the preview counted a fairness-cleared reject as
// `summary.rejected += 1`, an outcome the pass can no longer produce. Unattended
// auto-reject was retired (UAT M6 / GDPR Art. 22) — every fairness-cleared reject
// is QUEUED as a held rejection_review — so every committed run records
// rejected:0. The recruiter was shown "N rejections", clicked, and got 0
// rejections plus N approval cards.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { markQueuedForApproval } from "./automation-pass.ts";
import type { AutomationDecision, AutomationSummary } from "./automation-pass.ts";
import { deriveDecisionOutcome } from "./decision-attribution.ts";

const emptySummary = (): AutomationSummary => ({
  advanced: 0,
  rejected: 0,
  held: 0,
  alerts: 0,
  errors: 0,
  evaluated: 3,
});

const rejectDecision = (): AutomationDecision => ({
  entryId: "e1",
  action: "reject",
  toStage: null,
  alerts: [],
  reason: "BAU score 31 below the 40 floor",
});

test("THE FIX: a previewed reject is QUEUED, not counted as a rejection", () => {
  const summary = emptySummary();
  const d = rejectDecision();
  markQueuedForApproval(d, summary, true);

  assert.equal(d.outcome, "queued");
  assert.equal(summary.held, 1);
  // The whole point: the preview must not forecast a rejection the commit
  // structurally cannot produce.
  assert.equal(summary.rejected, 0);
  assert.match(d.reason, /^Would be queued for approval: /);
  // The original policy reason survives — the recruiter still sees WHY.
  assert.match(d.reason, /BAU score 31 below the 40 floor/);
});

test("preview and commit produce the SAME summary movement and outcome", () => {
  const previewSummary = emptySummary();
  const commitSummary = emptySummary();
  const previewed = rejectDecision();
  const committed = rejectDecision();

  markQueuedForApproval(previewed, previewSummary, true);
  markQueuedForApproval(committed, commitSummary, false);

  // Byte-identical summaries: same held bump, same (zero) rejected, on both paths.
  assert.deepEqual(previewSummary, commitSummary);
  assert.equal(previewed.outcome, committed.outcome);
  // ONLY the wording differs — a forecast reads as a forecast.
  assert.match(committed.reason, /^Queued for approval: /);
  assert.notEqual(previewed.reason, committed.reason);
});

test("both wordings still derive the `queued` outcome for persisted rows", () => {
  // scheduler_runs rows written before the `outcome` field existed are
  // reconstructed from the reason prefix, so the commit wording must keep
  // matching deriveDecisionOutcome's "Queued for approval" prefix.
  const summary = emptySummary();
  const committed = rejectDecision();
  markQueuedForApproval(committed, summary, false);
  assert.equal(deriveDecisionOutcome({ reason: committed.reason }), "queued");
  // With the explicit field present, both paths derive `queued` regardless of wording.
  const previewed = rejectDecision();
  markQueuedForApproval(previewed, emptySummary(), true);
  assert.equal(deriveDecisionOutcome(previewed), "queued");
});
