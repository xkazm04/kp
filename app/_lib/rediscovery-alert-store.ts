import Database from "better-sqlite3";
import { openStore } from "./db-path";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { randomId } from "./random-id";
import { outreachSuppressionReason, type ConsentSnapshot } from "./consent";
import { resolveCandidateConsent } from "./rediscovery-relevance";
import { optedOutCandidateIds } from "./outreach-state-store";

// Standing silver-medalist alerts (idea-fdb45cd0). Isolated-connection store
// (same pattern as application-status-store.ts / offers-store.ts): owns the
// `rediscovery_alerts` table. Rediscovery used to be a button a recruiter had to
// remember to click per role; this persists each "a candidate you rejected from
// Role X clears the bar for new Role Y" hit so it surfaces in a dismissable feed
// the moment it becomes true — on publish, or on a manual pool-change sweep.
//
// A row is keyed UNIQUE on (workspace_id, job_id, candidate_id) so re-running the
// ranking for the same role never accretes duplicates AND never resurrects an alert
// the team already dismissed (INSERT OR IGNORE preserves the existing row,
// dismissed_at and all) — per team, because the key is the team's (tenant-keys.test.ts).

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
  // The dedup key, per TEAM. It used to be ux_rediscovery_alert ON (job_id,
  // candidate_id) — a key on a team-scoped table without workspace_id. DROP first:
  // `CREATE UNIQUE INDEX IF NOT EXISTS` under the old name would be a silent no-op on
  // every existing DB. After the ALTER above, so a legacy table has the column. Both
  // statements are idempotent, so this runs every open at no cost. No existing row can
  // collide on the wider key (it is a superset of the old one).
  d.exec(`
    DROP INDEX IF EXISTS ux_rediscovery_alert;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_rediscovery_alert_team
      ON rediscovery_alerts(workspace_id, job_id, candidate_id);
  `);
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

/** THE WRITE WALL. An alert row carries the person's LABEL (their name) and is shown
 *  to every recruiter in the feed, so persisting one for a person who may not be
 *  surfaced re-materializes exactly the identifiable data the gate exists to keep off a
 *  shared screen. rediscoverForJob already filters the pool; this is the second wall so
 *  no future caller can write a withheld person's alert past it. It reads the SAME
 *  predicate as the rank gate and the feed read (withheldCandidateIds: erasure, lapsed
 *  consent AND opt-out) — it used to check consent only, so an opted-out person's name
 *  was persisted. Resolved BEFORE any transaction: it is a read on other tables, and
 *  keeping it out of the write keeps the transaction the pure write loop it claims to be. */
function admissibleRows(
  jobId: string,
  rows: RediscoveryAlertInput[],
  withheld: Map<string, WithheldReason>
): RediscoveryAlertInput[] {
  const admissible = withheld.size === 0 ? rows : rows.filter((r) => !withheld.has((r.candidateId ?? "").trim()));
  if (admissible.length < rows.length) {
    console.warn(
      `[rediscovery] ${rows.length - admissible.length} of ${rows.length} silver medalists for job "${jobId}" were NOT persisted — withheld (anonymized, lapsed consent or opted out).`
    );
  }
  return admissible;
}

const INSERT_ALERT_SQL = `
    INSERT OR IGNORE INTO rediscovery_alerts
      (id, job_id, job_title, candidate_id, candidate_label, archetype, score, prior_kind, prior_label, prior_stage, prior_depth, created_at, workspace_id)
    VALUES (@id, @jobId, @jobTitle, @candidateId, @label, @archetype, @score, @priorKind, @priorLabel, @priorStage, @priorDepth, @createdAt, @workspaceId)
  `;

function alertParams(jobId: string, jobTitle: string, r: RediscoveryAlertInput, now: string, workspaceId: string) {
  return {
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
  };
}

/** Persist a role's rediscovered candidates as standing alerts. INSERT OR IGNORE
 *  on the (workspace_id, job_id, candidate_id) unique index: a candidate this team
 *  already alerted for this role (active or dismissed) is left untouched, so the feed neither
 *  duplicates nor un-dismisses. Returns the count of genuinely-new alerts. This is the
 *  insert-only form; the publish/sweep raise uses reconcileRediscoveryAlerts below, which
 *  also refreshes and retracts. */
export function recordRediscoveryAlerts(
  jobId: string,
  jobTitle: string,
  rows: RediscoveryAlertInput[],
  workspaceId: string = DEFAULT_WORKSPACE_ID
): number {
  if (rows.length === 0) return 0;
  const admissible = admissibleRows(jobId, rows, withheldCandidateIds(rows.map((r) => r.candidateId)));
  if (admissible.length === 0) return 0;
  const d = db();
  const now = new Date().toISOString();
  const insert = d.prepare(INSERT_ALERT_SQL);
  const tx = d.transaction((items: RediscoveryAlertInput[]): number => {
    let added = 0;
    for (const r of items) {
      if (insert.run(alertParams(jobId, jobTitle, r, now, workspaceId)).changes > 0) added += 1;
    }
    return added;
  });
  return tx(admissible);
}

export type ReconcileOutcome = { added: number; updated: number; retracted: number };

/** Make one role's alerts a PROJECTION of its latest complete ranking, not a pile of
 *  first-sweep snapshots.
 *
 *  - `qualifying` (the ranking's silver medalists) that pass the write wall are
 *    INSERTED when new, and an existing UNDISMISSED row is REFRESHED (score, prior,
 *    label) — a JD edit or a new CV used to leave the first sweep's score frozen.
 *    A refresh is not counted as new (`added` stays the "N surfaced" number).
 *  - An UNDISMISSED row is RETRACTED (deleted) when its candidate was `evaluated` (the
 *    ranker returned a real verdict on them) and no longer qualifies, OR when the person
 *    is now withheld by the eligibility gate (erased, lapsed, opted out). Withheld-ness is
 *    positive evidence independent of the ranking, so it is read over this role's live
 *    rows too, and a withheld person's name leaves the table, not only the screen.
 *  - A candidate ABSENT from `evaluated` (ranking failed, pool truncated, over the
 *    display cut, unscored) is never retracted: absence from an incomplete ranking is
 *    not evidence of disqualification. A failed ranking never reaches this function.
 *  - A DISMISSED row is never touched: the dismissal stays sticky.
 *
 *  Read -> write safety: the gate read runs BEFORE the transaction (other stores'
 *  tables, no await anywhere); every write re-asserts `workspace_id`, `job_id` and
 *  `dismissed_at IS NULL` in its WHERE and counts `changes`, inside one IMMEDIATE
 *  transaction, so a row dismissed in between is left alone. Workspace-scoped: another
 *  team's rows for the same job + candidate are never read or written. */
export function reconcileRediscoveryAlerts(
  jobId: string,
  jobTitle: string,
  qualifying: RediscoveryAlertInput[],
  evaluated: readonly string[],
  workspaceId: string = DEFAULT_WORKSPACE_ID
): ReconcileOutcome {
  const d = db();
  const liveIds = (
    d
      .prepare(`SELECT candidate_id FROM rediscovery_alerts WHERE workspace_id = ? AND job_id = ? AND dismissed_at IS NULL`)
      .all(workspaceId, jobId) as { candidate_id: string }[]
  ).map((r) => r.candidate_id);
  // ONE gate read over everyone this call could write or keep: the candidates to
  // insert/refresh, and the role's live rows (so a since-withheld person is retracted).
  const withheld = withheldCandidateIds([...qualifying.map((r) => r.candidateId), ...liveIds]);
  const admissible = admissibleRows(jobId, qualifying, withheld);
  const keep = new Set(admissible.map((r) => (r.candidateId ?? "").trim()));
  const retract = new Set<string>();
  for (const id of evaluated) {
    const key = (id ?? "").trim();
    if (key && !keep.has(key)) retract.add(key);
  }
  for (const id of liveIds) if (withheld.has(id.trim())) retract.add(id);

  const now = new Date().toISOString();
  const insert = d.prepare(INSERT_ALERT_SQL);
  const refresh = d.prepare(`
    UPDATE rediscovery_alerts
       SET job_title = @jobTitle, candidate_label = @label, archetype = @archetype, score = @score,
           prior_kind = @priorKind, prior_label = @priorLabel, prior_stage = @priorStage, prior_depth = @priorDepth
     WHERE workspace_id = @workspaceId AND job_id = @jobId AND candidate_id = @candidateId AND dismissed_at IS NULL
  `);
  const remove = d.prepare(
    `DELETE FROM rediscovery_alerts WHERE workspace_id = ? AND job_id = ? AND candidate_id = ? AND dismissed_at IS NULL`
  );
  const tx = d.transaction((): ReconcileOutcome => {
    let added = 0;
    let updated = 0;
    let retracted = 0;
    for (const r of admissible) {
      const params = alertParams(jobId, jobTitle, r, now, workspaceId);
      if (insert.run(params).changes > 0) added += 1;
      else updated += refresh.run(params).changes;
    }
    for (const id of retract) retracted += remove.run(workspaceId, jobId, id).changes;
    return { added, updated, retracted };
  });
  return tx.immediate();
}

// ---- Retention (rediscovery-excludes-the-unconsented) -----------------------
//
// `rediscovery_alerts` had no delete anywhere in the tree. A dismissed row is kept
// on purpose — the UNIQUE (workspace_id, job_id, candidate_id) index is what makes dismissal
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
 *  team's feed — and dismissal is STICKY: the UNIQUE (workspace_id, job_id, candidate_id) index
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

/** Why a person may not be surfaced by rediscovery. */
export type WithheldReason = "anonymized" | "consent_expired" | "opted_out";

/** THE ONE eligibility predicate for rediscovery ("may this person be surfaced for a
 *  role they never applied to?"), composing the consent/erasure half
 *  (suppressedCandidateIds, above) and the person's own opt-out (optedOutCandidateIds,
 *  outreach-state-store) in ONE place. Callers import it from `./rediscovery-eligibility`,
 *  the canonical site. It is DEFINED here only because this store's write wall needs it
 *  and that module re-exports from this one; defining it there would make the store and
 *  the gate import each other.
 *
 *  Precedence, most restrictive first: an erasure is terminal (`anonymized`), then the
 *  person's own objection (`opted_out`), then a lapsed grant (`consent_expired`). Both
 *  halves FAIL CLOSED (a read error withholds every id) and are workspace-GLOBAL (a
 *  property of the person, not the team); an id with no entry anywhere is absent
 *  (contactable). One batched, chunked read per half, never one per candidate. */
export function withheldCandidateIds(
  candidateIds: readonly (string | null | undefined)[],
  nowMs: number = Date.now()
): Map<string, WithheldReason> {
  const consent = suppressedCandidateIds(candidateIds, nowMs);
  const optedOut = optedOutCandidateIds(candidateIds);
  const out = new Map<string, WithheldReason>();
  for (const id of optedOut) out.set(id, "opted_out");
  for (const [id, reason] of consent) {
    if (reason === "anonymized" || !out.has(id)) out.set(id, reason);
  }
  return out;
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
