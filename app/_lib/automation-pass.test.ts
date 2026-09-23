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
import { applyPassDecisions, entriesForPass, markQueuedForApproval, recordDecisionAlerts } from "./automation-pass.ts";
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

// --- commit the pass you previewed (challenge-r02 pipeline-actions-events/B) -------
// The executed half of automation-commit-plan: what the commit loop writes when the
// recruiter's reviewed selection rides along, and that it is one TEAM's selection.

const stageOf = (id: string) =>
  (ensureDb().prepare(`SELECT stage FROM pipeline_entries WHERE id = ?`).get(id) as { stage: string }).stage;

function seedIn(ws: string, stage = "Screened"): string {
  const { entry } = createPipelineEntry({
    candidateId: `c-sel-${Math.random()}`,
    candidateLabel: "Selection Test",
    jobId: `job-sel-${ws}`,
    jobTitle: "Selection Role",
    stage,
    workspaceId: ws,
  });
  return entry.id;
}
const advanceOf = (id: string, alerts: string[] = []): AutomationDecision => ({
  entryId: id,
  action: "advance",
  toStage: "Interview",
  alerts,
  reason: "score 88 clears the advance bar",
});
const snapsOf = (...ids: string[]) => listActiveEntriesForAutomation().filter((e) => ids.includes(e.id));

test("case 2 (executed): an unticked advance is skipped as notApproved and the entry does not move", () => {
  const id = seedIn("ws-sel-a");
  const s = emptySummary();
  const [d] = applyPassDecisions([advanceOf(id)], snapsOf(id), s, { approved: [], workspace: "ws-sel-a" });
  assert.equal(d.outcome, "skipped");
  assert.equal(d.reasonCode, "notApproved");
  assert.equal(d.action, "none");
  assert.equal(stageOf(id), "Screened", "pipeline_entries is untouched");
  assert.equal(s.advanced, 0);
});

test("case 1 (executed): a ticked advance lands", () => {
  const id = seedIn("ws-sel-a");
  const s = emptySummary();
  const [d] = applyPassDecisions([advanceOf(id)], snapsOf(id), s, {
    approved: [{ entryId: id, action: "advance", toStage: "Interview" }],
    workspace: "ws-sel-a",
  });
  assert.equal(d.outcome, "applied");
  assert.notEqual(stageOf(id), "Screened");
  assert.equal(s.advanced, 1);
});

test("case 3 (executed): a drifted row is not applied and carries changedSincePreview", () => {
  const id = seedIn("ws-sel-a");
  const s = emptySummary();
  const hold: AutomationDecision = { entryId: id, action: "hold", toStage: null, alerts: [], reason: "awaiting score" };
  const [d] = applyPassDecisions([hold], snapsOf(id), s, {
    approved: [{ entryId: id, action: "advance", toStage: "Interview" }],
    workspace: "ws-sel-a",
  });
  assert.equal(d.outcome, "skipped");
  assert.equal(d.reasonCode, "changedSincePreview");
  assert.equal(stageOf(id), "Screened");
});

test("case 4 + TENANCY: team A's selection neither applies nor holds back team B's rows", () => {
  const mine = seedIn("ws-sel-a");
  const theirs = seedIn("ws-sel-b");
  // The pass a selection runs is scoped to the reviewing team BEFORE it runs.
  const scoped = entriesForPass(listActiveEntriesForAutomation(), "ws-sel-a");
  assert.ok(scoped.some((e) => e.id === mine));
  assert.ok(!scoped.some((e) => e.id === theirs), "another team's entry is not in a scoped pass");

  // Defence in depth: even handed team B's decision, with B's id in A's selection, the
  // commit drops it - not applied, not recorded as a skip, not in the result.
  const s = emptySummary();
  const out = applyPassDecisions([advanceOf(mine), advanceOf(theirs)], snapsOf(mine, theirs), s, {
    approved: [
      { entryId: mine, action: "advance", toStage: "Interview" },
      { entryId: theirs, action: "advance", toStage: "Interview" },
    ],
    workspace: "ws-sel-a",
  });
  assert.deepEqual(out.map((d) => d.entryId), [mine], "the foreign row never appears in the response");
  assert.equal(stageOf(theirs), "Screened", "not applied by this caller");

  // …and not HELD BACK either: team B's own (unselected) commit still advances it.
  const later = applyPassDecisions([advanceOf(theirs)], snapsOf(theirs), emptySummary());
  assert.equal(later[0].outcome, "applied");
  assert.notEqual(stageOf(theirs), "Screened");
});

test("case 5 guard: without a selection the commit applies exactly what the pass decided", () => {
  const id = seedIn("ws-sel-c");
  const s = emptySummary();
  const [d] = applyPassDecisions([advanceOf(id)], snapsOf(id), s);
  assert.equal(d.outcome, "applied");
  assert.equal(s.advanced, 1);
});

test("case 7: an unticked advance still writes its alert (alerts stay autonomous)", () => {
  const id = seedIn("ws-sel-a", "Offer");
  ensureDb().prepare(`UPDATE pipeline_entries SET stage_changed_at = ? WHERE id = ?`).run(daysAgo(8), id);
  const s = emptySummary();
  applyPassDecisions([advanceOf(id, ["aging_alert"])], snapsOf(id), s, { approved: [], workspace: "ws-sel-a" });
  assert.equal(rows(id, "aging_alert"), 1, "the entry stays in its stint, so the stint's alert is written");
  assert.equal(stageOf(id), "Offer");
});

test("an unticked would-be reject is not queued for approval", () => {
  const id = seedIn("ws-sel-a");
  ensureDb().prepare(`UPDATE pipeline_entries SET match_score = 20 WHERE id = ?`).run(id);
  const reject: AutomationDecision = { entryId: id, action: "reject", toStage: null, alerts: [], reason: "BAU 20 below the floor" };
  const [d] = applyPassDecisions([reject], snapsOf(id), emptySummary(), { approved: [], workspace: "ws-sel-a" });
  // Either the fairness backstop holds it (autonomous) or the selection declines it -
  // in neither case does a rejection_review land without the recruiter's tick.
  const approval = ensureDb().prepare(`SELECT approval_kind FROM pipeline_entries WHERE id = ?`).get(id) as { approval_kind: string | null };
  assert.notEqual(approval.approval_kind, "rejection_review");
  assert.notEqual(d.outcome, "queued");
});
