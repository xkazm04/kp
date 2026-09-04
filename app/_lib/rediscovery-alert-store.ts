import Database from "better-sqlite3";
import { openStore } from "./db-path";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { randomId } from "./random-id";
import { outreachSuppressionReason, type ConsentSnapshot } from "./consent";
import { resolveCandidateConsent } from "./rediscovery-relevance";

// Standing silver-medalist alerts (idea-fdb45cd0). Isolated-connection store
// (same pattern as application-status-store.ts / offers-store.ts): owns the
// `rediscovery_alerts` table. Rediscovery used to be a button a recruiter had to
// remember to click per role; this persists each "a candidate you rejected from
// Role X clears the bar for new Role Y" hit so it surfaces in a dismissable feed
// the moment it becomes true — on publish, or on a manual pool-change sweep.
//
// A row is keyed UNIQUE on (job_id, candidate_id) so re-running the ranking for
// the same role never accretes duplicates AND never resurrects an alert the
// recruiter already dismissed (INSERT OR IGNORE preserves the existing row,
// dismissed_at and all).

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  // Isolated connection on the shared kp.sqlite file (WAL + busy_timeout=5000):
  // the publish/sweep writers interleave with the rest of the app on the same
  // file — wait briefly rather than throwing SQLITE_BUSY (sibling stores).
  const d = openStore();
  d.exec(`
    CREATE TABLE IF NOT EXISTS rediscovery_alerts (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      job_title TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      candidate_label TEXT NOT NULL,
      archetype TEXT NOT NULL DEFAULT 'bau',
      score INTEGER NOT NULL,
      prior_kind TEXT NOT NULL,
      prior_label TEXT NOT NULL,
      prior_stage TEXT,
      prior_depth INTEGER,
      created_at TEXT NOT NULL,
      dismissed_at TEXT,
      workspace_id TEXT NOT NULL DEFAULT 'workspace'
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_rediscovery_alert
      ON rediscovery_alerts(job_id, candidate_id);
  `);
  // Tenancy scoping (E0 Phase 1): workspace_id on a pre-existing table (isolated store
  // → migrate here, tolerating the already-present column).
  try {
    d.exec(`ALTER TABLE rediscovery_alerts ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'workspace'`);
  } catch {
    /* column already exists — idempotent */
  }
  // feed-tells-why: the persisted alert used to carry only the prior's kind + a
  // legacy English label, so the standing feed couldn't tell the same localized
  // why-now story the panel does. Additively record the prior's terminal STAGE and
  // its band-limited DEPTH boost (the {kind,label,stage,depth} live shape) so the
  // feed can rebuild the localized disclosure. Nullable on purpose — rows written
  // before this migration read NULL and render exactly as before (legacy English
  // label). Per-column try/catch mirrors the workspace_id migration above.
  for (const col of ["prior_stage TEXT", "prior_depth INTEGER"]) {
    try {
      d.exec(`ALTER TABLE rediscovery_alerts ADD COLUMN ${col}`);
    } catch {
      /* column already exists — idempotent */
    }
  }
  _db = d;
  return d;
}

export type RediscoveryAlertInput = {
  candidateId: string;
  label: string;
  archetype: string;
  score: number;
  // The full live prior shape (Rediscovered.prior). `stage` is the prior's terminal
  // pipeline stage and `depth` its band-limited ordering boost — persisted so the feed
  // rebuilds the same localized why-now the panel renders. Structurally a superset of
  // the legacy {kind,label}, so a Rediscovered flows straight in.
  prior: { kind: string; label: string; stage: string; depth: number };
};

export type RediscoveryAlert = {
  id: string;
  jobId: string;
  jobTitle: string;
  candidateId: string;
  label: string;
  archetype: string;
  score: number;
  // `stage`/`depth` are NULL for legacy rows written before the feed-tells-why
  // migration — the feed falls back to the legacy English `label` for those.
  prior: { kind: string; label: string; stage: string | null; depth: number | null };
  createdAt: string;
};

/** Persist a role's rediscovered candidates as standing alerts. INSERT OR IGNORE
 *  on the (job_id, candidate_id) unique index: a candidate already alerted for
 *  this role (active or dismissed) is left untouched, so the feed neither
 *  duplicates nor un-dismisses. Returns the count of genuinely-new alerts (so the
 *  publish/sweep caller can report "3 silver medalists surfaced"). */
export function recordRediscoveryAlerts(
  jobId: string,
  jobTitle: string,
  rows: RediscoveryAlertInput[],
  workspaceId: string = DEFAULT_WORKSPACE_ID
): number {
  if (rows.length === 0) return 0;
  // CONSENT IS A WRITE GATE HERE, not only a send gate. An alert row carries the
  // person's LABEL (their name) and is shown to every recruiter in the feed, so
  // persisting one for a candidate who was anonymized/erased or whose consent
  // lapsed re-materializes exactly the identifiable data the erasure removed —
  // rediscoverForJob already filters the pool, and this is the second wall so no
  // future caller can write an unconsented alert past it. Suppression is resolved
  // BEFORE the transaction (it is a read on another table; better-sqlite3 is
  // synchronous so there is no await either way, but keeping the read out of the
  // write keeps the transaction the pure INSERT loop it claims to be).
  const suppressed = suppressedCandidateIds(rows.map((r) => r.candidateId));
  const admissible = suppressed.size === 0 ? rows : rows.filter((r) => !suppressed.has((r.candidateId ?? "").trim()));
  if (admissible.length < rows.length) {
    console.warn(
      `[rediscovery] ${rows.length - admissible.length} of ${rows.length} silver medalists for job "${jobId}" were NOT persisted — consent suppressed (anonymized or lapsed).`
    );
  }
  if (admissible.length === 0) return 0;
  const d = db();
  const now = new Date().toISOString();
  const insert = d.prepare(`
    INSERT OR IGNORE INTO rediscovery_alerts
      (id, job_id, job_title, candidate_id, candidate_label, archetype, score, prior_kind, prior_label, prior_stage, prior_depth, created_at, workspace_id)
    VALUES (@id, @jobId, @jobTitle, @candidateId, @label, @archetype, @score, @priorKind, @priorLabel, @priorStage, @priorDepth, @createdAt, @workspaceId)
  `);
  const tx = d.transaction((items: RediscoveryAlertInput[]): number => {
    let added = 0;
    for (const r of items) {
      const res = insert.run({
        id: randomId("ra"),
        jobId,
        jobTitle,
        candidateId: r.candidateId,
        label: r.label,
        archetype: r.archetype,
        score: r.score,
        priorKind: r.prior.kind,
        priorLabel: r.prior.label,
        priorStage: r.prior.stage,
        priorDepth: r.prior.depth,
        createdAt: now,
        workspaceId,
      });
      if (res.changes > 0) added += 1;
    }
    return added;
  });
  return tx(admissible);
}

// ---- Retention (rediscovery-excludes-the-unconsented) -----------------------
//
// `rediscovery_alerts` had no delete anywhere in the tree. A dismissed row is kept
// on purpose — the UNIQUE (job_id, candidate_id) index is what makes dismissal
// STICKY, so deleting it the moment it is dismissed would let the very next sweep
// re-raise the alert the recruiter just waved away. But "sticky" only has to
// outlive the reason it was dismissed for, and an alert row is not archival
// provenance: it carries a candidate LABEL (a name) for a re-contact that never
// happened, so keeping it forever is data minimisation running the wrong way.
//
// Two windows, both stated rather than implied:
//  - a DISMISSED row is kept for ALERT_DISMISSED_RETENTION_DAYS. Long enough that
//    a re-sweep of the same role cannot resurrect it in any realistic cadence
//    (the on-demand sweep is per-Refresh, the publish trigger per go-live), and
//    after that a genuinely still-eligible candidate SHOULD be re-offered — the
//    role, the pool and the bar have all had a month to change.
//  - an UNDISMISSED row past ALERT_STALE_RETENTION_DAYS is dead weight: nobody
//    acted on it in a quarter. It is already invisible in most cases (the feed
//    filters relevance against live job/pipeline state, so an unpublished role's
//    alerts stop rendering long before this), and if the role is still live the
//    next sweep re-raises it with a fresh timestamp.

/** How long a DISMISSED alert is kept so re-sweeps cannot resurrect it. */
export const ALERT_DISMISSED_RETENTION_DAYS = 30;
/** How long an un-acted-on alert is kept before it is dropped as stale. */
export const ALERT_STALE_RETENTION_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Drop dismissed alerts past their retention window and undismissed ones that
 *  went stale. Idempotent, best-effort, and deliberately workspace-GLOBAL — this
 *  runs from the process clock, which has no session tenant, and it deletes by AGE
 *  alone: it can neither surface nor suppress one team's alert in another's feed
 *  (that is the explicit exemption recorded in rediscovery-tenancy.test.ts).
 *  `nowMs`/windows are injectable so the windows are testable without waiting. */
export function pruneRediscoveryAlerts(
  opts: { nowMs?: number; dismissedDays?: number; staleDays?: number } = {}
): { dismissed: number; stale: number } {
  const nowMs = opts.nowMs ?? Date.now();
  const dismissedDays = opts.dismissedDays ?? ALERT_DISMISSED_RETENTION_DAYS;
  const staleDays = opts.staleDays ?? ALERT_STALE_RETENTION_DAYS;
  const d = db();
  const dismissedCutoff = new Date(nowMs - dismissedDays * DAY_MS).toISOString();
  const staleCutoff = new Date(nowMs - staleDays * DAY_MS).toISOString();
  // Two statements rather than one OR'd DELETE so the caller (and the clock log)
  // can report the two windows honestly instead of one opaque total.
  const dismissed = d
    .prepare(`DELETE FROM rediscovery_alerts WHERE dismissed_at IS NOT NULL AND dismissed_at < ?`)
    .run(dismissedCutoff).changes;
  const stale = d
    .prepare(`DELETE FROM rediscovery_alerts WHERE dismissed_at IS NULL AND created_at < ?`)
    .run(staleCutoff).changes;
  return { dismissed, stale };
}

/** All un-dismissed alerts, newest (and within a timestamp, highest-scoring)
 *  first. Relevance (job still published, candidate not since pipelined) is
 *  filtered by the caller against live pipeline/job state — see
 *  filterRelevantAlerts. */
export function listRediscoveryAlerts(workspaceId: string = DEFAULT_WORKSPACE_ID): RediscoveryAlert[] {
  const rows = db()
    .prepare(
      `SELECT id, job_id, job_title, candidate_id, candidate_label, archetype, score, prior_kind, prior_label, prior_stage, prior_depth, created_at
       FROM rediscovery_alerts
       WHERE dismissed_at IS NULL AND workspace_id = ?
       ORDER BY created_at DESC, score DESC`
    )
    .all(workspaceId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    jobId: r.job_id as string,
    jobTitle: r.job_title as string,
    candidateId: r.candidate_id as string,
    label: r.candidate_label as string,
    archetype: r.archetype as string,
    score: r.score as number,
    prior: {
      kind: r.prior_kind as string,
      label: r.prior_label as string,
      // Legacy rows (pre-migration) read NULL — kept null so the feed can fall back
      // to the legacy English label rather than fabricate a stage/depth.
      stage: (r.prior_stage as string | null) ?? null,
      depth: (r.prior_depth as number | null) ?? null,
    },
    createdAt: r.created_at as string,
  }));
}

/** Dismiss one alert, scoped to the CALLER's workspace.
 *
 *  The by-id predicate alone is NOT sufficient authorization here. An alert id is not
 *  a capability token — listRediscoveryAlerts hands it to every recruiter in that
 *  team's feed — and dismissal is STICKY: the UNIQUE (job_id, candidate_id) index
 *  makes every later sweep an INSERT OR IGNORE no-op, so a dismissed row never comes
 *  back. Without the workspace predicate, anyone holding an id could permanently
 *  suppress ANOTHER team's silver-medalist alert.
 *
 *  Guarded to a still-active row IN THIS WORKSPACE → res.changes===0 covers "already
 *  dismissed", "never existed", and "not yours" identically, which is exactly the
 *  answer a caller should get for all three (no existence oracle, no new branch).
 *
 *  CALLERS MUST THREAD THE SESSION WORKSPACE. The DEFAULT_WORKSPACE_ID default only
 *  matches the sibling list/record signatures — a request-scoped caller that omits it
 *  targets the default tenant, so a non-default team's dismiss would silently no-op
 *  (the row returns on reload). /api/rediscovery/alerts PATCH already resolves
 *  `currentWorkspace()` for GET/POST; it must pass the same value here. */
export function dismissRediscoveryAlert(id: string, workspaceId: string = DEFAULT_WORKSPACE_ID): boolean {
  const res = db()
    .prepare(
      `UPDATE rediscovery_alerts SET dismissed_at = ?
        WHERE id = ? AND workspace_id = ? AND dismissed_at IS NULL`
    )
    .run(new Date().toISOString(), id, workspaceId);
  return res.changes > 0;
}

// ---- Cross-role outreach consent gate (bug-ui-scan #1) ----------------------
//
// Rediscovery re-contacts a candidate under a DIFFERENT role, and the "Reach out"
// route mints a brand-new pipeline entry whose consent columns are blank — so a
// per-ENTRY consent read (dispatchOutreach's original gate) reports "none"
// (contactable) even for a person whose ORIGINAL consent expired or who was
// anonymized/erased, silently defeating the suppression the gate exists to
// enforce. Consent/anonymization are keyed to the ENTRY, but the durable identity
// erasure + consent use is `candidate_id` — so resolve suppression against THAT,
// across every one of the candidate's entries. Lives here (the rediscovery
// module's DB seam) rather than db/pipeline.ts, reading pipeline_entries over this
// isolated store's connection — every store opens the same kp.sqlite file.

/** Every entry's consent snapshot for ONE durable candidate identity
 *  (`candidate_id`). Isolated-connection read on the shared kp.sqlite.
 *  DELIBERATELY workspace-GLOBAL — like anonymizeExpiredConsents' "process EVERY
 *  tenant's expired consents" sweep, a person's consent/erasure is a property of
 *  the person, not the team; reading only lifecycle timestamps (no PII/labels)
 *  and over-suppressing across a rare same-id collision is the GDPR-safe
 *  direction. Do not add a workspace filter here. */
export function candidateConsentSnapshots(candidateId: string): ConsentSnapshot[] {
  const key = (candidateId ?? "").trim();
  if (!key) return [];
  const rows = db()
    .prepare(
      `SELECT consent_given_at, consent_expires_at, anonymized_at
         FROM pipeline_entries WHERE candidate_id = ?`
    )
    .all(key) as { consent_given_at: string | null; consent_expires_at: string | null; anonymized_at: string | null }[];
  return rows.map((r) => ({
    givenAt: r.consent_given_at,
    expiresAt: r.consent_expires_at,
    anonymizedAt: r.anonymized_at,
  }));
}

/** The BATCH form of candidateOutreachSuppression, for the rank-time filter: which
 *  of these candidate identities may NOT be re-contacted, and why. One SELECT per
 *  chunk instead of one per candidate (the pool is capped near 160, so the
 *  per-candidate form would be 160 round-trips on every publish and every swept
 *  role). Same semantics as the singular gate: workspace-GLOBAL (a person's
 *  consent/erasure is a property of the person), most-restrictive across every
 *  entry the identity owns, and an id with no entry anywhere is contactable.
 *
 *  FAIL CLOSED on a read error: every id is reported suppressed, so a broken
 *  consent read surfaces NOBODY rather than surfacing everybody. A rediscovery
 *  that finds no one is recoverable on the next sweep; re-materializing an erased
 *  person's name in a shared feed is not. */
export function suppressedCandidateIds(
  candidateIds: readonly (string | null | undefined)[],
  nowMs: number = Date.now()
): Map<string, "anonymized" | "consent_expired"> {
  const out = new Map<string, "anonymized" | "consent_expired">();
  const ids = [...new Set(candidateIds.map((c) => (c ?? "").trim()).filter(Boolean))];
  if (ids.length === 0) return out;
  try {
    const grouped = new Map<string, ConsentSnapshot[]>();
    // Chunked so the parameter list stays well under SQLite's SQLITE_MAX_VARIABLE_NUMBER
    // however large a future pool cap gets.
    const CHUNK = 400;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const rows = db()
        .prepare(
          `SELECT candidate_id, consent_given_at, consent_expires_at, anonymized_at
             FROM pipeline_entries WHERE candidate_id IN (${slice.map(() => "?").join(",")})`
        )
        .all(...slice) as {
        candidate_id: string;
        consent_given_at: string | null;
        consent_expires_at: string | null;
        anonymized_at: string | null;
      }[];
      for (const r of rows) {
        const list = grouped.get(r.candidate_id) ?? [];
        list.push({ givenAt: r.consent_given_at, expiresAt: r.consent_expires_at, anonymizedAt: r.anonymized_at });
        grouped.set(r.candidate_id, list);
      }
    }
    for (const [id, snaps] of grouped) {
      const reason = outreachSuppressionReason(resolveCandidateConsent(snaps), nowMs);
      if (reason) out.set(id, reason);
    }
    return out;
  } catch (err) {
    // ONE exception to fail-closed, and it is a logical identity rather than a
    // loophole: if `pipeline_entries` does not exist yet (this isolated connection
    // opened on a database whose core schema db/pipeline.ts has not created — a
    // fresh install, or a test that only touches the alert store), then there are no
    // entries, so there are no consent records, so nobody CAN be suppressed by one.
    // Treating that as "suppress everyone" would make rediscovery return nobody on a
    // brand-new deployment and read as a broken feature.
    if (err instanceof Error && /no such table/i.test(err.message)) return out;
    console.error(
      `[rediscovery] consent gate could not resolve ${ids.length} candidate identities — suppressing all of them (fail-closed):`,
      err
    );
    for (const id of ids) out.set(id, "consent_expired");
    return out;
  }
}

/** THE candidate-level outreach compliance gate (GDPR / e-privacy). Resolves the
 *  most-restrictive consent across every entry the candidate identity owns, so a
 *  rediscovery re-contact honors the PERSON's real state — anonymized/erased, or
 *  every consent grant lapsed — not the fresh per-role entry's blank consent.
 *  `entrySnapshot` (the outreach entry's own consent) is folded in so a caller
 *  that has no candidateId still gets the entry-level guarantee unchanged.
 *
 *  FAIL CLOSED: if the consent state cannot be read (DB error), suppress — a
 *  missed send is recoverable, a consent-violating send is not. Returns the
 *  suppression reason, or null when the candidate may be contacted. */
export function candidateOutreachSuppression(
  candidateId: string | null | undefined,
  entrySnapshot?: ConsentSnapshot,
  nowMs: number = Date.now()
): "anonymized" | "consent_expired" | null {
  try {
    const snaps: ConsentSnapshot[] = entrySnapshot ? [entrySnapshot] : [];
    const key = (candidateId ?? "").trim();
    if (key) snaps.push(...candidateConsentSnapshots(key));
    // Truly no record anywhere (no id, no entry) — recruiter-sourced first touch,
    // contactable, exactly as an entry-level "none" read.
    if (snaps.length === 0) return null;
    return outreachSuppressionReason(resolveCandidateConsent(snaps), nowMs);
  } catch (err) {
    console.error(
      `[rediscovery] consent gate could not resolve candidate "${candidateId}" — suppressing outreach (fail-closed):`,
      err
    );
    return "consent_expired";
  }
}
