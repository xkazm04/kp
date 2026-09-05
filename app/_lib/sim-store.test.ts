// bug-ui-scan-2026-07-09 (guided-pipeline-simulation #2): resetSim must purge ONLY
// the caller's tenant. The pre-fix DELETEs on `jobs`/`jds` were workspace-UNSCOPED,
// so a reset run by ANY workspace (an operator, or a demo session's auto-reset at
// run start) reached across the shared tables and destroyed another tenant's (SIM)
// rows. These proofs seed two workspaces' (SIM) artifacts, reset ONE, and assert the
// other survives — which FAILS against the pre-fix code (the cross-tenant job/jd was
// wrongly deleted there). Non-vacuity holds only because the "survives" assertions
// are on the OTHER workspace's rows, exactly what the unscoped DELETE clobbered.
//
// unit-db is the FIRST project import (throwaway KP_DB_PATH) — load-bearing order.
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { openStore } from "./db-path.ts";
import { ensureDb } from "./db/core.ts";
import { createPipelineEntry, getPipelineEntry } from "./db/pipeline.ts";
import { listDecisionRecords } from "./decision-record-store.ts";
import { getGroupEval } from "./group-eval.ts";
import { getOpenOfferForEntry } from "./offers-store.ts";
import { listScheduleInvites } from "./schedule-store.ts";
import { outreachStateFor } from "./outreach-state-store.ts";
import { resetSim, SIM_PURGED_TABLES, beginSimRun, endSimRun, renewSimRun, simRunActive, SIM_RUN_TTL_MS, __resetSimRunLocks } from "./sim-store.ts";
import { SIM_MARKER } from "@/app/features/shell/simulation/constants";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";

after(() => cleanupUnitDb());

// Seed a (SIM)-marked job + pipeline_entry into a given workspace using the SAME
// connection resetSim opens, so there's no cross-connection visibility question.
function seedSimArtifacts(workspaceId: string, suffix: string): { jobId: string; entryId: string } {
  ensureDb(); // create the full schema (jobs/jds/pipeline_* columns incl. workspace_id)
  const d = openStore();
  const now = new Date().toISOString();
  const jobId = `job-${suffix}`;
  const entryId = `entry-${suffix}`;
  const title = `Backend Engineer ${SIM_MARKER}`;
  d.prepare(
    `INSERT INTO jobs (id, title, payload_json, status, workspace_id, created_at) VALUES (?, ?, ?, 'draft', ?, ?)`
  ).run(jobId, title, "{}", workspaceId, now);
  d.prepare(
    `INSERT INTO jds (slug, title, body, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)`
  ).run(`jd-${suffix}`, title, "body", now, workspaceId);
  d.prepare(
    `INSERT INTO pipeline_entries (id, candidate_id, candidate_label, archetype, job_id, job_title, stage, status, created_at, updated_at, workspace_id)
     VALUES (?, ?, ?, ?, ?, ?, 'Accepted', 'active', ?, ?, ?)`
  ).run(entryId, `cand-${suffix}`, `Candidate ${suffix}`, "generalist", jobId, title, now, now, workspaceId);
  return { jobId, entryId };
}

const jobExists = (id: string) => !!openStore().prepare(`SELECT 1 FROM jobs WHERE id = ?`).get(id);
const jdExists = (slug: string) => !!openStore().prepare(`SELECT 1 FROM jds WHERE slug = ?`).get(slug);
const entryExists = (id: string) => !!openStore().prepare(`SELECT 1 FROM pipeline_entries WHERE id = ?`).get(id);

test("resetSim purges ONLY the caller's workspace and cannot reach across tenants", () => {
  const mine = seedSimArtifacts("demo", "mine");
  const theirs = seedSimArtifacts("workspace", "theirs");

  const cleared = resetSim("demo");

  // The caller's own (SIM) artifacts are gone.
  assert.equal(entryExists(mine.entryId), false, "caller's sim entry should be purged");
  assert.equal(jobExists(mine.jobId), false, "caller's sim job should be purged");
  assert.equal(jdExists("jd-mine"), false, "caller's sim jd should be purged");

  // The OTHER tenant's artifacts survive — the crux the pre-fix unscoped DELETE broke.
  assert.equal(entryExists(theirs.entryId), true, "other tenant's sim entry must survive");
  assert.equal(jobExists(theirs.jobId), true, "other tenant's sim job must survive (unscoped DELETE would have removed it)");
  assert.equal(jdExists("jd-theirs"), true, "other tenant's sim jd must survive (unscoped DELETE would have removed it)");

  // The returned counts reflect the caller's tenant only (one of each).
  assert.equal(cleared.jobs, 1, "exactly the caller's one sim job counted");
  assert.equal(cleared.jds, 1, "exactly the caller's one sim jd counted");
  assert.equal(cleared.entries, 1, "exactly the caller's one sim entry counted");
});

// ---------------------------------------------------------------------------
// /perfect wave 22 — the purge is no longer true about five tables and silent
// about eight more that a single walk writes into.
//
// The five it named — offers, pipeline_events, pipeline_entries, jobs, jds — are the
// ones reachable through the "(SIM)" title. The eight it did not are reachable only
// through a key the purge already resolves: the SIM entry ids (decision_records,
// schedule_invites, consent_events, outreach_state, dev_outbox), the SIM job ids
// (group_evals, job_ingests) and the SIM jd slugs (jd_revisions). Every one of them
// accumulated, run after run, in a tenant every demo visitor shares.
//
// Below: one full walk's write set seeded and purged; the metering tables and
// another tenant's rows left alone; and the per-workspace run lock.

const WS = DEFAULT_WORKSPACE_ID;
const OTHER = "team-bystander";
const SIM_JOB = "sim-walk-job";
const SIM_SLUG = "sim-walk-slug";
const NOW = new Date().toISOString();

// Every isolated store creates its tables lazily on first use, so touch each one
// before the raw seeding below — otherwise the INSERTs hit "no such table" and the
// purge's own tolerance would make the test vacuous.
before(() => {
  // pipeline_entries FIRST: listScheduleInvites joins it, so warming the invite
  // store before the core tables exist throws "no such table".
  getPipelineEntry("warm", WS);
  listDecisionRecords({ limit: 1 });
  getGroupEval("warm", WS);
  getOpenOfferForEntry("warm");
  listScheduleInvites(1, WS);
  outreachStateFor("warm", WS);
});

function seedWalk(workspaceId: string, entryId: string) {
  const d = openStore();
  d.prepare(`INSERT OR REPLACE INTO jobs (id, title, payload_json, workspace_id, created_at) VALUES (?, ?, '{}', ?, ?)`).run(
    SIM_JOB,
    `Senior Java Backend Engineer ${SIM_MARKER}`,
    workspaceId,
    NOW
  );
  d.prepare(`INSERT OR REPLACE INTO jds (slug, title, body, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)`).run(
    SIM_SLUG,
    `Senior Java Backend Engineer ${SIM_MARKER}`,
    "body",
    NOW,
    workspaceId
  );
  d.prepare(`INSERT INTO jd_revisions (slug, title, body, created_at) VALUES (?, ?, ?, ?)`).run(SIM_SLUG, "old", "old body", NOW);
  d.prepare(`INSERT OR REPLACE INTO job_ingests (content_hash, job_id, created_at, workspace_id) VALUES (?, ?, ?, ?)`).run(
    `hash-${workspaceId}`,
    SIM_JOB,
    NOW,
    workspaceId
  );
  d.prepare(
    `INSERT INTO decision_records (prev_hash, content_hash, kind, actor, policy_version, candidate_ref, rationale, reason_code, payload_json, created_at, workspace_id, key_id)
     VALUES ('', 'h', 'screening', 'auto:sim', 'v1', ?, 'r', 'rc', '{}', ?, ?, '')`
  ).run(entryId, NOW, workspaceId);
  d.prepare(`INSERT INTO schedule_invites (id, token, entry_id, workspace_id, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)`).run(
    `inv-${entryId}`,
    `tok-${entryId}`,
    entryId,
    workspaceId,
    NOW
  );
  d.prepare(`INSERT INTO consent_events (entry_id, kind, detail, created_at, workspace_id) VALUES (?, 'granted', null, ?, ?)`).run(
    entryId,
    NOW,
    workspaceId
  );
  d.prepare(`INSERT OR REPLACE INTO outreach_state (entry_id, sends, last_sent_at, workspace_id) VALUES (?, 1, ?, ?)`).run(entryId, NOW, workspaceId);
  d.prepare(`INSERT INTO dev_outbox (id, recipient, subject, body, kind, channel, status, ref, created_at) VALUES (?, 'c@x.io', 's', 'b', 'offer', 'dev', 'sent', ?, ?)`).run(
    `out-${entryId}`,
    entryId,
    NOW
  );
  d.prepare(`INSERT OR REPLACE INTO group_evals (role_key, role_title, payload_json, created_at, workspace_id) VALUES (?, ?, '{}', ?, ?)`).run(
    SIM_JOB,
    "Senior Java Backend Engineer",
    NOW,
    workspaceId
  );
  d.prepare(`INSERT OR REPLACE INTO offers (id, entry_id, token, status, created_at) VALUES (?, ?, ?, 'open', ?)`).run(
    `off-${entryId}`,
    entryId,
    `otok-${entryId}`,
    NOW
  );
}

function count(sql: string, ...params: unknown[]): number {
  return (openStore().prepare(sql).get(...params) as { n: number }).n;
}

test("a full walk's write set is purged in the caller's tenant — every table, not just the five with a (SIM) title", () => {
  const mine = createPipelineEntry({
    candidateId: "sim-walk-cand",
    candidateLabel: "Demo Candidate",
    jobId: SIM_JOB,
    jobTitle: `Senior Java Backend Engineer ${SIM_MARKER}`,
    workspaceId: WS,
    stage: "Offer",
  }).entry;
  seedWalk(WS, mine.id);

  // Precondition: the eight formerly-unpurged tables really do hold a row.
  assert.equal(count(`SELECT COUNT(*) n FROM decision_records WHERE candidate_ref = ?`, mine.id), 1);
  assert.equal(count(`SELECT COUNT(*) n FROM schedule_invites WHERE entry_id = ?`, mine.id), 1);
  assert.equal(count(`SELECT COUNT(*) n FROM consent_events WHERE entry_id = ?`, mine.id), 1);
  assert.equal(count(`SELECT COUNT(*) n FROM outreach_state WHERE entry_id = ?`, mine.id), 1);
  assert.equal(count(`SELECT COUNT(*) n FROM dev_outbox WHERE ref = ?`, mine.id), 1);
  assert.equal(count(`SELECT COUNT(*) n FROM group_evals WHERE role_key = ?`, SIM_JOB), 1);
  assert.equal(count(`SELECT COUNT(*) n FROM job_ingests WHERE job_id = ?`, SIM_JOB), 1);
  assert.equal(count(`SELECT COUNT(*) n FROM jd_revisions WHERE slug = ?`, SIM_SLUG), 1);

  const cleared = resetSim(WS);

  assert.equal(count(`SELECT COUNT(*) n FROM pipeline_entries WHERE id = ?`, mine.id), 0);
  assert.equal(count(`SELECT COUNT(*) n FROM decision_records WHERE candidate_ref = ?`, mine.id), 0, "the sealed demo decisions are gone");
  assert.equal(count(`SELECT COUNT(*) n FROM schedule_invites WHERE entry_id = ?`, mine.id), 0, "the self-scheduling link is gone");
  assert.equal(count(`SELECT COUNT(*) n FROM consent_events WHERE entry_id = ?`, mine.id), 0);
  assert.equal(count(`SELECT COUNT(*) n FROM outreach_state WHERE entry_id = ?`, mine.id), 0, "the sends counter is gone: it decides reply-vs-application");
  assert.equal(count(`SELECT COUNT(*) n FROM dev_outbox WHERE ref = ?`, mine.id), 0);
  assert.equal(count(`SELECT COUNT(*) n FROM group_evals WHERE role_key = ? AND workspace_id = ?`, SIM_JOB, WS), 0);
  assert.equal(count(`SELECT COUNT(*) n FROM job_ingests WHERE job_id = ? AND workspace_id = ?`, SIM_JOB, WS), 0, "the dedupe key is gone: the next run's identical JD must source");
  assert.equal(count(`SELECT COUNT(*) n FROM jd_revisions WHERE slug = ?`, SIM_SLUG), 0);
  assert.equal(count(`SELECT COUNT(*) n FROM jobs WHERE id = ?`, SIM_JOB), 0);
  assert.equal(count(`SELECT COUNT(*) n FROM jds WHERE slug = ?`, SIM_SLUG), 0);

  // The response reports every table it cleared — the honest-reset property.
  assert.deepEqual(Object.keys(cleared).sort(), [...SIM_PURGED_TABLES].sort());
  for (const table of SIM_PURGED_TABLES) {
    assert.ok(cleared[table] >= 1, `${table} reported ${cleared[table]}, expected the seeded row to be counted`);
  }
});

test("tasks and llm_usage survive: a demo may not erase its own metering", () => {
  const d = openStore();
  d.prepare(`INSERT OR REPLACE INTO tasks (id, kind, status, created_at, workspace_id) VALUES ('sim-task', 'group_eval', 'done', ?, ?)`).run(NOW, WS);
  resetSim(WS);
  assert.equal(count(`SELECT COUNT(*) n FROM tasks WHERE id = 'sim-task'`), 1, "the spend ledger is not the demo's to clear");
});

test("another tenant's identical walk is untouched", () => {
  const theirs = createPipelineEntry({
    candidateId: "sim-walk-other",
    candidateLabel: "Their Candidate",
    jobId: SIM_JOB,
    jobTitle: `Senior Java Backend Engineer ${SIM_MARKER}`,
    workspaceId: OTHER,
    stage: "Offer",
  }).entry;
  seedWalk(OTHER, theirs.id);

  resetSim(WS);

  assert.equal(count(`SELECT COUNT(*) n FROM pipeline_entries WHERE id = ?`, theirs.id), 1);
  assert.equal(count(`SELECT COUNT(*) n FROM decision_records WHERE candidate_ref = ?`, theirs.id), 1);
  assert.equal(count(`SELECT COUNT(*) n FROM group_evals WHERE role_key = ? AND workspace_id = ?`, SIM_JOB, OTHER), 1);
  assert.equal(count(`SELECT COUNT(*) n FROM job_ingests WHERE job_id = ? AND workspace_id = ?`, SIM_JOB, OTHER), 1);

  // …and its own reset clears it.
  const cleared = resetSim(OTHER);
  assert.ok(cleared.entries >= 1);
  assert.equal(count(`SELECT COUNT(*) n FROM pipeline_entries WHERE id = ?`, theirs.id), 0);
});

test("an empty tenant resets to all zeros instead of throwing on an empty IN ()", () => {
  const cleared = resetSim("team-never-demoed");
  for (const table of SIM_PURGED_TABLES) assert.equal(cleared[table], 0, table);
});

// --- the run lock -------------------------------------------------------------

/** Claim and hand back the lease token, failing loudly if the claim was refused —
 *  every lock test below needs the token, and `ok` narrows the union. */
function claim(workspaceId: string, now?: number): string {
  const c = now === undefined ? beginSimRun(workspaceId) : beginSimRun(workspaceId, now);
  assert.ok(c.ok, `expected a free tenant for ${workspaceId}`);
  return c.token;
}

test("one live run per workspace: the second start is refused, not served a wipe", () => {
  __resetSimRunLocks();
  claim(WS);
  const second = beginSimRun(WS);
  assert.equal(second.ok, false, "a second start while a walk is live must refuse");
  assert.ok(!second.ok && second.retryAfterMs > 0, "and say how long the holder's lease has left");
  assert.ok(beginSimRun(OTHER).ok, "the lock is per workspace, never global");
});

test("the lease token is minted, not derived from the workspace a caller already knows", () => {
  __resetSimRunLocks();
  const a = claim(WS);
  endSimRun(WS, a);
  const b = claim(WS);
  assert.notEqual(a, b, "two claims on the same tenant never share a token");
  assert.doesNotMatch(a, new RegExp(WS), "and the token carries no part of the workspace id");
  assert.ok(a.length >= 32, "a guessable token would let a refused tab free the holder anyway");
});

test("the lease expires, so a closed tab cannot lock a tenant forever", () => {
  __resetSimRunLocks();
  const t0 = 1_000_000;
  claim(WS, t0);
  assert.equal(simRunActive(WS, t0 + 1_000).active, true);
  assert.equal(simRunActive(WS, t0 + 6 * 60_000).active, false, "past the TTL the tenant is free again");
  assert.ok(beginSimRun(WS, t0 + 6 * 60_000).ok);
});

test("release is idempotent — done, stopped and failed all end the same way", () => {
  __resetSimRunLocks();
  const token = claim(WS);
  assert.deepEqual(endSimRun(WS, token), { released: true });
  assert.deepEqual(endSimRun(WS, token), { released: true }, "releasing a lease that is already gone is a success");
  assert.equal(simRunActive(WS).active, false);
  assert.ok(beginSimRun(WS).ok);
  __resetSimRunLocks();
});

// --- two tabs: the wave-22 regression, two presses away -----------------------
//
// Tab A starts a walk; tab B's start is REFUSED with SIM_RUN_ACTIVE and then runs
// its own `finally` release. Before wave 44 that release freed A's lease (endSimRun
// took a workspace and nothing else), so B's next press claimed the tenant and
// resetSim wiped A's live run. The lease token is what makes B's release a no-op.
test("a refused start cannot release the winner's lease", () => {
  __resetSimRunLocks();
  const tabA = claim(WS);

  const tabB = beginSimRun(WS);
  assert.equal(tabB.ok, false, "tab B is refused: one live run per workspace");

  // tab B's cleanup path, with no lease of its own to present.
  const stray = endSimRun(WS, null);
  assert.equal(stray.released, false, "a caller that never claimed cannot free the holder");
  assert.ok(!stray.released && stray.retryAfterMs > 0, "and is told how long A's lease has left");
  const wrongToken = endSimRun(WS, "not-the-holders-token");
  assert.equal(wrongToken.released, false, "nor can a caller holding some other run's token");

  assert.equal(simRunActive(WS).active, true, "A still owns its tenant");
  assert.equal(beginSimRun(WS).ok, false, "so B's next press is refused too, instead of wiping A mid-walk");

  assert.deepEqual(endSimRun(WS, tabA), { released: true }, "only A ends A's run");
  assert.equal(simRunActive(WS).active, false);
  __resetSimRunLocks();
});

// --- renewing: the lease outlives a presenter who talks -----------------------

test("the holder renews its lease, so a talked-through phase does not outlive it", () => {
  __resetSimRunLocks();
  const t0 = 2_000_000;
  const token = claim(WS, t0);
  const before = simRunActive(WS, t0 + 4 * 60_000).retryAfterMs;

  const renewed = renewSimRun(WS, token, t0 + 4 * 60_000);
  assert.ok(renewed.ok, "the holder may always renew");
  assert.equal(simRunActive(WS, t0 + 4 * 60_000).retryAfterMs, SIM_RUN_TTL_MS, "the expiry moved a full TTL out");
  assert.ok(simRunActive(WS, t0 + 4 * 60_000).retryAfterMs > before);
  assert.equal(simRunActive(WS, t0 + 8 * 60_000).active, true, "past the ORIGINAL expiry the run is still protected");
  __resetSimRunLocks();
});

test("a non-owner cannot renew, and an expired lease is not silently re-minted", () => {
  __resetSimRunLocks();
  const t0 = 3_000_000;
  const token = claim(WS, t0);

  const foreign = renewSimRun(WS, "some-other-tabs-token", t0 + 1_000);
  assert.equal(foreign.ok, false, "renewing someone else's run would hand two tabs a lease each");
  assert.ok(!foreign.ok && foreign.retryAfterMs > 0);
  assert.equal(simRunActive(WS, t0 + 1_000).retryAfterMs, SIM_RUN_TTL_MS - 1_000, "and the holder's expiry did not move");

  const late = renewSimRun(WS, token, t0 + 6 * 60_000);
  assert.equal(late.ok, false, "a lease that already expired is lost, not resurrected");
  assert.equal(simRunActive(WS, t0 + 6 * 60_000).active, false);
  __resetSimRunLocks();
});
