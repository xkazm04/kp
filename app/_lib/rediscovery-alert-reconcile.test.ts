// Alerts are a reconciled projection of the latest COMPLETE ranking, gated at write and
// refiltered at read by the one eligibility predicate (challenge-r08 candidate-rediscovery/A).
//
// Before: the write wall checked consent only (an opted-out person's name was persisted),
// INSERT OR IGNORE froze a row at its first score forever, nothing retracted a row whose
// candidate stopped qualifying, and the feed read re-checked neither consent, erasure nor
// opt-out — so an erased or opted-out person kept an "Add to pipeline" row for 90 days.
//
// Runner: node:test with type stripping — `npm run test:unit`.
import { test, after } from "node:test";
import assert from "node:assert/strict";

// Throwaway DB — MUST stay the first project import (db-path freezes KP_DB_PATH).
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { ensureDb } from "./db/core.ts";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";
import { anonymizeEntry, createPipelineEntry } from "./db/pipeline.ts";
import { recordCandidateOptOut } from "./outreach-state-store.ts";
import {
  dismissRediscoveryAlert,
  listRediscoveryAlerts,
  reconcileRediscoveryAlerts,
  recordRediscoveryAlerts,
} from "./rediscovery-alert-store.ts";
import { liveRediscoveryAlerts } from "./rediscover.ts";

after(() => cleanupUnitDb());

const WS = DEFAULT_WORKSPACE_ID;
const JOB = "rec-jobY";

const row = (candidateId: string, score = 71, depth = 1) => ({
  candidateId,
  label: `Person ${candidateId}`,
  archetype: "bau",
  score,
  prior: { kind: "rejected", label: "Rejected · Role X", stage: "Interview", depth },
});

/** The person's prior entry under ANOTHER role — the silver-medalist history. */
const priorEntry = (candidateId: string) =>
  createPipelineEntry({ candidateId, candidateLabel: `Person ${candidateId}`, jobId: "rec-roleX", jobTitle: "Role X" }).entry;

const alertFor = (candidateId: string, jobId = JOB) =>
  listRediscoveryAlerts(WS).find((a) => a.candidateId === candidateId && a.jobId === jobId);

/** Every row for the pair, dismissed or not — reconcile must not touch dismissed ones. */
function rawRow(candidateId: string, jobId = JOB) {
  return ensureDb()
    .prepare(`SELECT score, prior_depth, dismissed_at FROM rediscovery_alerts WHERE workspace_id = ? AND job_id = ? AND candidate_id = ?`)
    .get(WS, jobId, candidateId) as { score: number; prior_depth: number; dismissed_at: string | null } | undefined;
}

// The feed read needs the role PUBLISHED in this workspace (listJobStatuses).
for (const id of [JOB, "rec-jobL"]) {
  ensureDb()
    .prepare(`INSERT INTO jobs (id, title, payload_json, status, workspace_id, published_at, created_at) VALUES (?, ?, ?, 'published', ?, ?, ?)`)
    .run(id, "Role Y", JSON.stringify({ id, title: "Role Y" }), WS, new Date().toISOString(), new Date().toISOString());
}

test("the write wall refuses an OPTED-OUT person (not only the unconsented)", () => {
  const e = priorEntry("rec-halted");
  recordCandidateOptOut(e.id);
  assert.equal(recordRediscoveryAlerts(JOB, "Role Y", [row("rec-halted")], WS), 0);
  assert.equal(alertFor("rec-halted"), undefined, "an opted-out person's name is never persisted");
  // …and reconcile holds the same wall.
  const r = reconcileRediscoveryAlerts(JOB, "Role Y", [row("rec-halted")], ["rec-halted"], WS);
  assert.equal(r.added, 0);
  assert.equal(alertFor("rec-halted"), undefined);
});

test("an opt-out AFTER the alert was recorded drops it from the live feed", () => {
  const e = priorEntry("rec-c1");
  assert.equal(recordRediscoveryAlerts(JOB, "Role Y", [row("rec-c1")], WS), 1);
  assert.ok(liveRediscoveryAlerts(WS).some((a) => a.candidateId === "rec-c1"), "non-vacuity: visible before the opt-out");
  recordCandidateOptOut(e.id);
  assert.equal(liveRediscoveryAlerts(WS).some((a) => a.candidateId === "rec-c1"), false);
});

test("an erasure AFTER the alert was recorded drops it from the live feed", () => {
  const e = priorEntry("rec-c2");
  assert.equal(recordRediscoveryAlerts(JOB, "Role Y", [row("rec-c2")], WS), 1);
  assert.ok(liveRediscoveryAlerts(WS).some((a) => a.candidateId === "rec-c2"), "non-vacuity: visible before the erasure");
  anonymizeEntry(e.id, "erasure");
  assert.equal(liveRediscoveryAlerts(WS).some((a) => a.candidateId === "rec-c2"), false);
});

test("reconcile retracts an undismissed alert whose candidate was ranked and no longer qualifies; a dismissal stays sticky", () => {
  priorEntry("rec-c3");
  priorEntry("rec-c3d");
  assert.equal(recordRediscoveryAlerts("rec-jobK", "Role Y", [row("rec-c3"), row("rec-c3d")], WS), 2);
  assert.equal(dismissRediscoveryAlert(alertFor("rec-c3d", "rec-jobK")!.id, WS), true);

  const r = reconcileRediscoveryAlerts("rec-jobK", "Role Y", [], ["rec-c3", "rec-c3d"], WS);
  assert.equal(r.retracted, 1, "only the undismissed row is retracted");
  assert.equal(rawRow("rec-c3", "rec-jobK"), undefined, "the stale alert is gone");
  assert.ok(rawRow("rec-c3d", "rec-jobK")?.dismissed_at, "the dismissed row is kept, so a re-sweep cannot resurrect it");
});

test("absence from an incomplete ranking is not evidence: an unevaluated candidate's alert is kept", () => {
  priorEntry("rec-keep");
  assert.equal(recordRediscoveryAlerts("rec-job4", "Role Y", [row("rec-keep")], WS), 1);
  const r = reconcileRediscoveryAlerts("rec-job4", "Role Y", [], [], WS);
  assert.equal(r.retracted, 0);
  assert.ok(alertFor("rec-keep", "rec-job4"), "never ranked this time => not retracted");
});

test("reconcile refreshes a live alert's score/prior without counting it as new, and never rewrites a dismissed one", () => {
  priorEntry("rec-c4");
  priorEntry("rec-c4d");
  assert.equal(recordRediscoveryAlerts("rec-jobN", "Role Y", [row("rec-c4", 71, 1), row("rec-c4d", 71, 1)], WS), 2);
  assert.equal(dismissRediscoveryAlert(alertFor("rec-c4d", "rec-jobN")!.id, WS), true);

  const r = reconcileRediscoveryAlerts("rec-jobN", "Role Y", [row("rec-c4", 82, 3), row("rec-c4d", 90, 3)], ["rec-c4", "rec-c4d"], WS);
  assert.equal(r.added, 0, "an update is not a new alert");
  const live = alertFor("rec-c4", "rec-jobN")!;
  assert.equal(live.score, 82);
  assert.equal(live.prior.depth, 3);
  const dismissed = rawRow("rec-c4d", "rec-jobN")!;
  assert.equal(dismissed.score, 71, "a dismissed row is not rewritten");
  assert.ok(dismissed.dismissed_at, "…and stays dismissed");
});

test("reconcile inserts a genuinely new qualifier and counts it", () => {
  priorEntry("rec-new");
  const r = reconcileRediscoveryAlerts("rec-jobL", "Role Y", [row("rec-new", 77, 0)], ["rec-new"], WS);
  assert.deepEqual(r, { added: 1, updated: 0, retracted: 0 });
  assert.ok(liveRediscoveryAlerts(WS).some((a) => a.candidateId === "rec-new"));
});

test("reconcile retracts a live alert for a person who has since been withheld, even if they were not re-ranked", () => {
  const e = priorEntry("rec-late-halt");
  assert.equal(recordRediscoveryAlerts("rec-jobT", "Role Y", [row("rec-late-halt")], WS), 1);
  recordCandidateOptOut(e.id);
  const r = reconcileRediscoveryAlerts("rec-jobT", "Role Y", [], [], WS);
  assert.equal(r.retracted >= 1, true);
  assert.equal(rawRow("rec-late-halt", "rec-jobT"), undefined, "a withheld person's live row is deleted, not just hidden");
});

test("reconcile is workspace-scoped: another team's alert for the same job + candidate is untouched", () => {
  priorEntry("rec-tenant");
  assert.equal(recordRediscoveryAlerts("rec-jobW", "Role Y", [row("rec-tenant")], "ws-other"), 1);
  const r = reconcileRediscoveryAlerts("rec-jobW", "Role Y", [], ["rec-tenant"], WS);
  assert.equal(r.retracted, 0);
  assert.ok(listRediscoveryAlerts("ws-other").some((a) => a.candidateId === "rec-tenant"));
});
