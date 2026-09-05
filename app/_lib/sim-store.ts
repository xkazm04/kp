import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { openStore } from "./db-path";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { SIM_TITLE_LIKE } from "@/app/features/shell/simulation/constants";

// Pipeline simulation — reset helper. Isolated connection (job-ingest/offers
// pattern; avoids the fork-churned db.ts) that clears every artifact a sim run
// created, identified by the "(SIM)" marker in the title, so the demo is cleanly
// re-runnable. WAL-safe alongside db.ts's own connection.

// The "what counts as a sim artifact" contract is the ONE marker in
// simulation/constants.ts; SIM_TITLE_LIKE is the shared SQL pattern derived from
// it (also used by the analytics read-side filter), so the writer, this purge and
// every aggregate filter can't drift (a drifted marker would silently leave sim
// rows behind — or, worse, a real job a user happened to title "(SIM)" would
// match). `(SIM)` has no LIKE wildcards, so it needs no escaping.
const MARKER = SIM_TITLE_LIKE;

// resetSim runs destructive DELETEs, so its catches must NOT swallow real SQL
// failures (which would let reset report success while leaving rows behind). The
// only tolerable error is a table that hasn't been created yet on a cold DB
// (offers/jds are made lazily by offers-store / db.ts); everything else re-throws.
function isNoSuchTable(err: unknown): boolean {
  return err instanceof Error && /no such table/i.test(err.message);
}

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  // Isolated connection on the shared kp.sqlite file (WAL + busy_timeout=5000):
  // resetSim runs a multi-statement DELETE transaction while db.ts / offers-store
  // may be mid-write; without the wait a concurrent writer makes the transaction
  // throw SQLITE_BUSY instantly — 500ing the reset and leaving sim rows behind (a
  // dirty next run). Wait briefly instead of crashing (mirrors offers-store).
  const d = openStore();
  _db = d;
  return d;
}

/** Every table `resetSim` clears, in the order it clears them. The RETURN SHAPE is
 *  derived from this list, so a table added to the purge is automatically reported
 *  by the reset response — the honest-reset property from wave 16, extended to the
 *  eight tables the purge was silent about. */
export const SIM_PURGED_TABLES = [
  "offers",
  "pipeline_events",
  "decision_records",
  "schedule_invites",
  "consent_events",
  "outreach_state",
  "dev_outbox",
  "group_evals",
  "job_ingests",
  "jd_revisions",
  "entries",
  "jobs",
  "jds",
] as const;

export type SimPurgeCounts = Record<(typeof SIM_PURGED_TABLES)[number], number>;

// --- The per-workspace run lock ----------------------------------------------
//
// Every anonymous demo visitor and every operator tab shares ONE tenant, and a run
// begins by deleting every SIM row in it. So a second start wiped the first one's
// job mid-walk and the victim died on an unrelated sentence ("intake returned
// none") while a stranger's tour carried on. This is the honest minimum: one live
// run per workspace, refused rather than raced. Per-VISITOR demo namespaces would
// remove the sharing entirely, but that is a tenancy-model change and the owner's
// call.
//
// In-process and best-effort ON PURPOSE: it guards the racing-tabs case that
// actually happens on one self-hosted server, not a multi-process deployment. It
// is a courtesy lock, never an authorization boundary — nothing downstream trusts
// it, and the DELETEs stay workspace-scoped either way.
//
// TTL, not a permanent claim: a browser that closes mid-run never sends its
// release, and a demo tenant locked forever by a closed tab is worse than the race.
// A full walk is ~2-3 minutes of beats.
export const SIM_RUN_TTL_MS = 5 * 60_000;

/** A lease is a workspace plus a TOKEN, not a workspace alone (/perfect wave 44).
 *  The wave-22 lock had no owner: DELETE /api/sim/reset released whoever held it,
 *  so a second tab whose start was REFUSED with SIM_RUN_ACTIVE still ran its own
 *  `finally` release, freed the first tab's lease, and the next press wiped a live
 *  run — the exact regression the lock exists to prevent, two presses away. The
 *  token is minted here from `randomUUID`, so it is never derivable from the
 *  workspace id a caller already knows; only the claimant can release or renew. */
type SimRunLease = { token: string; expiresAt: number };
const runLocks = new Map<string, SimRunLease>();

/** Claim the run lock for `workspaceId`. Returns the lease TOKEN the claimant must
 *  present to release or renew, or the ms until the holder's lease expires when it
 *  is already held — the caller answers SIM_RUN_ACTIVE with that. */
export function beginSimRun(workspaceId: string, now = Date.now()): { ok: true; token: string } | { ok: false; retryAfterMs: number } {
  const held = runLocks.get(workspaceId);
  if (held !== undefined && held.expiresAt > now) return { ok: false, retryAfterMs: held.expiresAt - now };
  const token = randomUUID();
  runLocks.set(workspaceId, { token, expiresAt: now + SIM_RUN_TTL_MS });
  return { ok: true, token };
}

/** Release the lock, but ONLY for the claimant that holds it.
 *
 *  Idempotent where idempotence is honest: a stop, a failure and the natural end of
 *  one run all release the same way, and a lease that already expired (or was never
 *  taken) is simply gone — `{ released: true }`, nothing to protect. What is NOT a
 *  no-op is a caller with no token, or the wrong one, asking to free a LIVE lease:
 *  that is someone else's run and it is refused with the holder's remaining time. */
export function endSimRun(
  workspaceId: string,
  token?: string | null,
  now = Date.now()
): { released: true } | { released: false; retryAfterMs: number } {
  const held = runLocks.get(workspaceId);
  if (held === undefined || held.expiresAt <= now) {
    runLocks.delete(workspaceId); // sweep the expired entry; nothing was owned
    return { released: true };
  }
  if (token && token === held.token) {
    runLocks.delete(workspaceId);
    return { released: true };
  }
  return { released: false, retryAfterMs: held.expiresAt - now };
}

/** Whether a live run holds this workspace. Used by the purge door, which must not
 *  delete a run's rows out from under it. */
export function simRunActive(workspaceId: string, now = Date.now()): { active: boolean; retryAfterMs: number } {
  const held = runLocks.get(workspaceId);
  if (held === undefined || held.expiresAt <= now) return { active: false, retryAfterMs: 0 };
  return { active: true, retryAfterMs: held.expiresAt - now };
}

/** Test seam only: drop every lease. */
export function __resetSimRunLocks(): void {
  runLocks.clear();
}

// A `WHERE <col> IN (?,?,…)` fragment, or null when there is nothing to match —
// SQLite accepts `IN ()` as a syntax error, and an empty purge must be a no-op
// rather than a thrown reset.
function inList(values: string[]): string | null {
  return values.length ? values.map(() => "?").join(",") : null;
}

/** Clear EVERY table a guided run writes into, scoped to `workspaceId`.
 *
 *  The wave-16 reset was honest about the five tables it named and silent about the
 *  eight more a single walk leaves behind: the JD revision snapshot, the job-ingest
 *  dedupe key, the outbox rows for the offer and the scheduling mail, the sealed
 *  decision records, the group evaluation, the scheduling invite, the consent events
 *  and the outreach counter. None of them are reachable through the (SIM) title, so
 *  each was keyed on something the purge ALREADY resolves: the SIM entry ids, the
 *  SIM job ids, and the SIM jd slugs.
 *
 *  `tasks` and `llm_usage` deliberately STAY. They are the metering record — what
 *  the run actually spent — and a demo that could erase its own usage ledger is a
 *  billing hole, not a clean reset.
 *
 *  Every count is reported, so the console can say what it really cleared. */
export function resetSim(workspaceId: string = DEFAULT_WORKSPACE_ID): SimPurgeCounts {
  const d = db();
  // The three key sets, resolved BEFORE the transaction (plain reads, no lock held).
  const entryIds = (
    d.prepare(`SELECT id FROM pipeline_entries WHERE job_title LIKE ? AND workspace_id = ?`).all(MARKER, workspaceId) as { id: string }[]
  ).map((r) => r.id);
  // Both directions: a job whose own title carries the marker, and the job any SIM
  // entry points at (the /api/sim/apply-cv path marks the ENTRY title while filing
  // against a real role — that role is not ours to delete, but its ingest key and
  // group evaluation are only reachable through this set, so keep the two apart).
  const simJobIds = (
    d.prepare(`SELECT id FROM jobs WHERE title LIKE ? AND workspace_id = ?`).all(MARKER, workspaceId) as { id: string }[]
  ).map((r) => r.id);
  let simSlugs: string[] = [];
  try {
    simSlugs = (d.prepare(`SELECT slug FROM jds WHERE title LIKE ? AND workspace_id = ?`).all(MARKER, workspaceId) as { slug: string }[]).map(
      (r) => r.slug
    );
  } catch (err) {
    if (!isNoSuchTable(err)) throw err; // tolerate only a not-yet-created table
  }

  const counts = Object.fromEntries(SIM_PURGED_TABLES.map((t) => [t, 0])) as SimPurgeCounts;

  // One statement, tolerating ONLY a table that a cold DB has not created yet
  // (offers/jds/group_evals/decision_records/schedule_invites are made lazily by
  // their isolated stores). Anything else re-throws: a reset that reported success
  // over a failed DELETE is exactly the lie this file exists to avoid.
  const run = (table: keyof SimPurgeCounts, sql: string, params: unknown[]) => {
    try {
      counts[table] += d.prepare(sql).run(...params).changes;
    } catch (err) {
      if (!isNoSuchTable(err)) throw err;
    }
  };

  const tx = d.transaction(() => {
    const entries = inList(entryIds);
    if (entries) {
      run("offers", `DELETE FROM offers WHERE entry_id IN (${entries})`, entryIds);
      run("pipeline_events", `DELETE FROM pipeline_events WHERE entry_id IN (${entries}) AND workspace_id = ?`, [...entryIds, workspaceId]);
      // The sealed screening/offer records the walk mints (Art. 22 gate). Their
      // candidate_ref IS the entry id, and they carry the entry's workspace.
      run("decision_records", `DELETE FROM decision_records WHERE candidate_ref IN (${entries}) AND workspace_id = ?`, [...entryIds, workspaceId]);
      // The self-scheduling invite + the slot the scripted candidate picked. Scoped
      // by entry alone: workspace_id is NULLABLE on this table (older rows), and the
      // entry ids are already workspace-resolved above.
      run("schedule_invites", `DELETE FROM schedule_invites WHERE entry_id IN (${entries})`, entryIds);
      // Consent events and the outreach counter: entry-keyed, and the counter is
      // what makes a later real inbound read as a REPLY rather than an application.
      run("consent_events", `DELETE FROM consent_events WHERE entry_id IN (${entries}) AND workspace_id = ?`, [...entryIds, workspaceId]);
      run("outreach_state", `DELETE FROM outreach_state WHERE entry_id IN (${entries}) AND workspace_id = ?`, [...entryIds, workspaceId]);
      // The dev outbox rows for the demo's offer + scheduling mail. `ref` is the
      // entry id; the table has no workspace column, so the entry set is the scope.
      run("dev_outbox", `DELETE FROM dev_outbox WHERE ref IN (${entries})`, entryIds);
    }
    const jobs = inList(simJobIds);
    if (jobs) {
      // The saved comparison for the demo role (role_key IS the job id) and the
      // ingest dedupe key, which otherwise makes the NEXT run's identical JD a
      // duplicate that never sources.
      run("group_evals", `DELETE FROM group_evals WHERE role_key IN (${jobs}) AND workspace_id = ?`, [...simJobIds, workspaceId]);
      run("job_ingests", `DELETE FROM job_ingests WHERE job_id IN (${jobs}) AND workspace_id = ?`, [...simJobIds, workspaceId]);
    }
    const slugs = inList(simSlugs);
    if (slugs) {
      // JD edit history for the demo JD. Slug-keyed, no workspace column — the slug
      // set came from the workspace-scoped jds read above.
      run("jd_revisions", `DELETE FROM jd_revisions WHERE slug IN (${slugs})`, simSlugs);
    }

    // The three rows the marker itself finds, deleted last so the key sets above
    // stayed resolvable for the whole transaction.
    run("entries", `DELETE FROM pipeline_entries WHERE job_title LIKE ? AND workspace_id = ?`, [MARKER, workspaceId]);
    // bug-ui-scan-2026-07-09 (guided-pipeline-simulation #2): scope the jobs/jds
    // purge by workspace_id too. Previously these were workspace-UNSCOPED, so ANY
    // caller's reset (an operator's, or a demo session's auto-reset at run start)
    // reached across the shared jobs/jds tables and destroyed another tenant's
    // (SIM) rows. The sim's JD/job are ingested under the caller's currentWorkspace()
    // (jds/save threads it), so scoping here purges exactly the caller's tenant.
    run("jobs", `DELETE FROM jobs WHERE title LIKE ? AND workspace_id = ?`, [MARKER, workspaceId]);
    run("jds", `DELETE FROM jds WHERE title LIKE ? AND workspace_id = ?`, [MARKER, workspaceId]);
    return counts;
  });

  return tx();
}
