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
//
// unit-db.ts MUST be the first project import: the alert-dedupe cases below write
// real pipeline_events rows into a throwaway SQLite file.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { markQueuedForApproval, recordDecisionAlerts } from "./automation-pass.ts";
import { createPipelineEntry, listActiveEntriesForAutomation } from "./db/pipeline.ts";
import { ensureDb } from "./db/core.ts";
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

// --- one aging clock: alerts once per stage STINT, not once per business day -------
// (challenge-r02 pipeline-actions-events/A). A stalled row used to get a fresh
// alert line in the feed every business day; a hire 30+ days old got one forever.

after(() => cleanupUnitDb());

const WS = "ws-alert-stint";
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000 - 3_600_000).toISOString();

function seedAt(stage: string, days: number): string {
  const { entry } = createPipelineEntry({
    candidateId: `c-${stage}-${days}-${Math.random()}`,
    candidateLabel: "Stint Test",
    jobId: "job-stint",
    jobTitle: "Stint Role",
    stage: "Screened",
    workspaceId: WS,
  });
  ensureDb().prepare(`UPDATE pipeline_entries SET stage = ?, stage_changed_at = ? WHERE id = ?`).run(stage, daysAgo(days), entry.id);
  return entry.id;
}
const snap = (id: string) => listActiveEntriesForAutomation().find((e) => e.id === id)!;
const rows = (id: string, kind: string) =>
  (ensureDb().prepare(`SELECT COUNT(*) AS n FROM pipeline_events WHERE entry_id = ? AND kind = ?`).get(id, kind) as { n: number }).n;
const backdateEvents = (id: string, kind: string, days: number) =>
  ensureDb()
    .prepare(`UPDATE pipeline_events SET created_at = ? WHERE entry_id = ? AND kind = ?`)
    .run(new Date(Date.now() - days * 86_400_000).toISOString(), id, kind);
const alertDecision = (id: string, alert: string, action: AutomationDecision["action"] = "hold"): AutomationDecision => ({
  entryId: id,
  action,
  toStage: null,
  alerts: [alert],
  reason: "offer waiting",
});

test("an aging alert is written ONCE per stage stint across three committed passes", () => {
  // Timeline: the Offer stint began 12 days ago; passes run on three different days.
  const id = seedAt("Offer", 12);
  const s = emptySummary();
  recordDecisionAlerts(alertDecision(id, "stale_alert"), snap(id), s, false);
  assert.equal(rows(id, "stale_alert"), 1, "first pass writes the alert");
  backdateEvents(id, "stale_alert", 1); // the next business day
  recordDecisionAlerts(alertDecision(id, "stale_alert"), snap(id), s, false);
  backdateEvents(id, "stale_alert", 2); // two days later
  recordDecisionAlerts(alertDecision(id, "stale_alert"), snap(id), s, false);
  assert.equal(rows(id, "stale_alert"), 1, "same stage, same tier -> still one row for the stint");
  assert.equal(s.alerts, 1);

  // A new stint: the Offer alert was written 9 days ago, the entry moved 6 days ago and
  // has aged past the new stage's SLA (interview role, 5 d).
  backdateEvents(id, "stale_alert", 9);
  ensureDb().prepare(`UPDATE pipeline_entries SET stage = 'Interview', stage_changed_at = ? WHERE id = ?`).run(daysAgo(6), id);
  recordDecisionAlerts(alertDecision(id, "stale_alert"), snap(id), s, false);
  assert.equal(rows(id, "stale_alert"), 2, "the next stint earns its own alert");
});

test("a dry run counts what the commit would write and writes nothing", () => {
  const id = seedAt("Offer", 4);
  const s = emptySummary();
  recordDecisionAlerts(alertDecision(id, "stale_alert"), snap(id), s, true);
  assert.equal(s.alerts, 1);
  assert.equal(rows(id, "stale_alert"), 0);
  recordDecisionAlerts(alertDecision(id, "stale_alert"), snap(id), s, false);
  const again = emptySummary();
  recordDecisionAlerts(alertDecision(id, "stale_alert"), snap(id), again, true);
  assert.equal(again.alerts, 0, "the preview applies the same stint dedupe");
});

test("an advance ends the stint: no aging alert is written about the stage being left", () => {
  const id = seedAt("Offer", 7);
  const s = emptySummary();
  recordDecisionAlerts(alertDecision(id, "aging_alert", "advance"), snap(id), s, false);
  assert.equal(rows(id, "aging_alert"), 0);
  assert.equal(s.alerts, 0);
});

test("fairness_gate_blocked_reject keeps its per-business-day dedupe", () => {
  const id = seedAt("Screened", 1);
  const kind = "fairness_gate_blocked_reject";
  const s = emptySummary();
  recordDecisionAlerts(alertDecision(id, kind), snap(id), s, false);
  recordDecisionAlerts(alertDecision(id, kind), snap(id), s, false);
  assert.equal(rows(id, kind), 1, "once per day");
  backdateEvents(id, kind, 1);
  recordDecisionAlerts(alertDecision(id, kind), snap(id), s, false);
  assert.equal(rows(id, kind), 2, "a new business day writes again");
});
