import { chunk, SQL_IN_CHUNK } from "../entries-param";
import { ensureDb, insertWithUniqueSlug, safeRowParse, type JobRecord } from "./core";

// Backgrounded AI generation state on a JD (see the core.ts migration). NULL/absent
// analysis_status = a legacy or manually-saved draft, treated as ready.
export type JdAnalysisStatus = "analyzing" | "ready" | "failed";

export type JdRow = {
  slug: string;
  title: string;
  body: string;
  created_at: string;
  // W8-4 — set when archived; loadJd still serves the row (banner, no 404).
  archived_at?: string | null;
  analysis_status?: JdAnalysisStatus | null;
  analysis_task_id?: string | null;
  analysis_error?: string | null;
  // JSON string: { role, salary, salarySources, salarySource, snapshot, case, options }
  // once ready; { options } while analyzing. Parsed by the JD detail view.
  analysis_json?: string | null;
};

// What the list endpoint exposes: identity + a short, server-truncated preview
// instead of the full body, so the list response stays bounded no matter how
// large individual JD bodies grow. Full bodies remain behind loadJd /
// GET /api/jds/[slug]. Carries the analysis state so the Ledger can render the
// "Analyzing"/"Failed" chip and link to live task progress.
export type JdListItem = {
  slug: string;
  title: string;
  preview: string;
  created_at: string;
  analysis_status?: JdAnalysisStatus | null;
  analysis_task_id?: string | null;
};

const JD_PREVIEW_CHARS = 280;

export type SaveJdInput = {
  title: string;
  body: string;
};

export function saveJd(input: SaveJdInput): { slug: string; createdAt: string } {
  const db = ensureDb();
  const createdAt = new Date().toISOString();
  const stmt = db.prepare(`INSERT INTO jds (slug, title, body, created_at) VALUES (?, ?, ?, ?)`);
  const slug = insertWithUniqueSlug((s) => stmt.run(s, input.title, input.body, createdAt));
  return { slug, createdAt };
}

// Backgrounded AI generation writers. The generate route inserts a placeholder JD
// up front (analysis_status='analyzing', empty body) so it appears in the Ledger
// immediately; the detached jd_build handler then flips it to ready/failed — which
// is why the JD survives the user navigating away (see docs/JD_LIFECYCLE.md).

/** Create the up-front placeholder for a backgrounded build. `options` (the ticked
 *  checklist) is stashed in analysis_json so the row knows what was requested even
 *  before the build finishes. Returns the minted slug. */
export function insertAnalyzingJd(input: { title: string; options: unknown }): { slug: string; createdAt: string } {
  const db = ensureDb();
  const createdAt = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO jds (slug, title, body, created_at, analysis_status, analysis_json)
     VALUES (?, ?, '', ?, 'analyzing', ?)`
  );
  const analysisJson = JSON.stringify({ options: input.options });
  const slug = insertWithUniqueSlug((s) => stmt.run(s, input.title, createdAt, analysisJson));
  return { slug, createdAt };
}

/** Link the placeholder to the task now running its build (progress / retry). */
export function setJdAnalysisTask(slug: string, taskId: string): void {
  ensureDb().prepare(`UPDATE jds SET analysis_task_id = ? WHERE slug = ?`).run(taskId, slug);
}

/** The build finished — write the body + structured artifacts and mark ready. Direct
 *  UPDATE (no jd_revisions snapshot): this is the first fill, not a user edit. */
export function finishJdAnalysis(slug: string, input: { body: string; analysisJson: unknown }): void {
  ensureDb()
    .prepare(`UPDATE jds SET body = ?, analysis_json = ?, analysis_status = 'ready', analysis_error = NULL WHERE slug = ?`)
    .run(input.body, JSON.stringify(input.analysisJson), slug);
}

/** The build errored — surface it on the row so the Ledger shows a failed chip + retry. */
export function failJdAnalysis(slug: string, error: string): void {
  ensureDb()
    .prepare(`UPDATE jds SET analysis_status = 'failed', analysis_error = ? WHERE slug = ?`)
    .run(error.slice(0, 2000), slug);
}

/** Reset a failed JD back to 'analyzing' for a retry (clears the prior error) so the
 *  Ledger reflects the re-run immediately, before the replayed build lands. */
export function markJdAnalyzing(slug: string): void {
  ensureDb().prepare(`UPDATE jds SET analysis_status = 'analyzing', analysis_error = NULL WHERE slug = ?`).run(slug);
}

export function listJds(limit = 100): JdListItem[] {
  const db = ensureDb();
  // Pull only one char past the preview window to detect truncation, so the
  // full body is never read into memory for the list view.
  const rows = db
    .prepare(
      `SELECT slug, title, created_at, analysis_status, analysis_task_id,
              substr(body, 1, ${JD_PREVIEW_CHARS + 1}) AS body_head,
              length(body) AS body_len
       FROM jds WHERE archived_at IS NULL ORDER BY created_at DESC LIMIT ?`
    )
    .all(limit) as Array<{
    slug: string;
    title: string;
    created_at: string;
    analysis_status: JdAnalysisStatus | null;
    analysis_task_id: string | null;
    body_head: string;
    body_len: number;
  }>;
  return rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    created_at: r.created_at,
    analysis_status: r.analysis_status,
    analysis_task_id: r.analysis_task_id,
    preview: r.body_len > JD_PREVIEW_CHARS ? `${r.body_head.slice(0, JD_PREVIEW_CHARS)}…` : r.body_head,
  }));
}

export function loadJd(slug: string): JdRow | null {
  const db = ensureDb();
  // Archived rows still load (W8-4): the public page renders them with a
  // banner so existing analysis/report links never 404.
  const row = db
    .prepare(
      `SELECT slug, title, body, created_at, archived_at,
              analysis_status, analysis_task_id, analysis_error, analysis_json
       FROM jds WHERE slug = ?`
    )
    .get(slug) as JdRow | undefined;
  return row ?? null;
}

// Optimistic-concurrency result for the JD write paths. `conflict` means the stored
// body changed since the editor loaded it (a second tab / another recruiter), so the
// write was refused rather than blind-overwriting their edit.
export type JdWriteResult = { ok: true } | { ok: false; reason: "not_found" | "conflict" };

/** Edit a saved JD in place (W8-4/JDL1 — the library was fully append-only, so
 *  every revision forked a permanent near-duplicate and orphaned the analysis
 *  history keyed on jd_slug). Caller validates via validateJdFields.
 *
 *  `baseBody` is the body the editor loaded: content-CAS optimistic concurrency. A
 *  blind UPDATE was last-write-wins — two recruiters (or a stale tab) editing the same
 *  JD silently clobbered each other, and the recorded snapshot was the INTERMEDIATE
 *  state, so the lost edit wasn't even reconstructable. Now the read+compare+write run
 *  in ONE synchronous transaction, so a stale base is detected (conflict) and the
 *  caller can prompt "this JD changed — reload". Omit baseBody to force the write. */
export function updateJd(slug: string, input: { title: string; body: string }, baseBody?: string): JdWriteResult {
  const db = ensureDb();
  // Snapshot the PRE-edit version into jd_revisions first (idea-6a18e0fc), in one
  // transaction with the overwrite, so an edit is always recoverable.
  const tx = db.transaction((): JdWriteResult => {
    const current = db.prepare(`SELECT title, body FROM jds WHERE slug = ?`).get(slug) as
      | { title: string; body: string }
      | undefined;
    if (!current) return { ok: false, reason: "not_found" };
    if (baseBody !== undefined && current.body !== baseBody) return { ok: false, reason: "conflict" };
    db.prepare(`INSERT INTO jd_revisions (slug, title, body, created_at) VALUES (?, ?, ?, ?)`).run(
      slug,
      current.title,
      current.body,
      new Date().toISOString()
    );
    db.prepare(`UPDATE jds SET title = ?, body = ? WHERE slug = ?`).run(input.title, input.body, slug);
    return { ok: true };
  });
  return tx();
}

export type JdRevision = { id: number; slug: string; title: string; body: string; created_at: string };

/** Edit history for a JD, newest first (idea-6a18e0fc). Each row is a PRE-edit
 *  snapshot taken when updateJd/revertJd overwrote the live JD. */
export function listJdRevisions(slug: string, limit = 30): JdRevision[] {
  return ensureDb()
    .prepare(`SELECT id, slug, title, body, created_at FROM jd_revisions WHERE slug = ? ORDER BY id DESC LIMIT ?`)
    .all(slug, Math.min(Math.max(limit, 1), 100)) as JdRevision[];
}

export type JdRevertResult =
  | { ok: true; title: string; body: string }
  | { ok: false; reason: "not_found" | "conflict" };

/** Restore a JD to a prior revision (idea-6a18e0fc). Snapshots the CURRENT version
 *  first (a revert is itself an edit, so it's undoable too), then overwrites. Same
 *  content-CAS as updateJd: `baseBody` is what the page showed when "Revert" was
 *  clicked — if the live body changed since, the revert is refused (conflict) so it
 *  can't silently bury an edit made in the gap. Returns the restored {title, body}. */
export function revertJd(slug: string, revisionId: number, baseBody?: string): JdRevertResult {
  const db = ensureDb();
  const tx = db.transaction((): JdRevertResult => {
    const rev = db.prepare(`SELECT title, body FROM jd_revisions WHERE id = ? AND slug = ?`).get(revisionId, slug) as
      | { title: string; body: string }
      | undefined;
    const current = db.prepare(`SELECT title, body FROM jds WHERE slug = ?`).get(slug) as
      | { title: string; body: string }
      | undefined;
    if (!rev || !current) return { ok: false, reason: "not_found" };
    if (baseBody !== undefined && current.body !== baseBody) return { ok: false, reason: "conflict" };
    db.prepare(`INSERT INTO jd_revisions (slug, title, body, created_at) VALUES (?, ?, ?, ?)`).run(
      slug,
      current.title,
      current.body,
      new Date().toISOString()
    );
    db.prepare(`UPDATE jds SET title = ?, body = ? WHERE slug = ?`).run(rev.title, rev.body, slug);
    return { ok: true, title: rev.title, body: rev.body };
  });
  return tx();
}

/** Archive / unarchive a JD (W8-4). Archived JDs leave listJds and the
 *  pickers; their public page stays up with a banner. */
export function setJdArchived(slug: string, archived: boolean): boolean {
  const db = ensureDb();
  return (
    db
      .prepare(`UPDATE jds SET archived_at = ? WHERE slug = ?`)
      .run(archived ? new Date().toISOString() : null, slug).changes > 0
  );
}

export type JobFilter = {
  roleFamily?: string;
  seniority?: string;
  workMode?: string;
  entryEligible?: boolean;
  // true = only roles candidates can apply to right now — same predicate as
  // isJobOpenForApplications (NULL = seeded/live, 'published' = live); drafts
  // and closed roles are held back.
  openOnly?: boolean;
  q?: string;
  limit?: number;
};

export function listJobs(filter: JobFilter = {}): JobRecord[] {
  const db = ensureDb();
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (filter.roleFamily) {
    where.push("role_family = @roleFamily");
    params.roleFamily = filter.roleFamily;
  }
  if (filter.seniority) {
    where.push("seniority = @seniority");
    params.seniority = filter.seniority;
  }
  if (filter.workMode) {
    where.push("work_mode = @workMode");
    params.workMode = filter.workMode;
  }
  if (filter.entryEligible !== undefined) {
    where.push("is_entry_eligible = @entry");
    params.entry = filter.entryEligible ? 1 : 0;
  }
  if (filter.openOnly) {
    // Mirrors isJobOpenForApplications (job-ingest.ts): NULL = seeded/live.
    where.push("(status IS NULL OR status = 'published')");
  }
  if (filter.q) {
    where.push("(title LIKE @q OR company LIKE @q)");
    params.q = `%${filter.q}%`;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  // Defensive clamp: never bind a NaN/negative/huge LIMIT even if a caller
  // skips validation. SQLite treats LIMIT -1 as unbounded, so guard the floor.
  params.limit =
    Number.isInteger(filter.limit) && (filter.limit as number) > 0
      ? Math.min(filter.limit as number, 500)
      : 300;
  const rows = db
    .prepare(
      `SELECT payload_json, status FROM jobs ${clause}
       ORDER BY is_entry_eligible DESC, graduate_friendliness DESC, id LIMIT @limit`
    )
    .all(params) as { payload_json: string; status: JobRecord["status"] }[];
  // Decorate each parsed payload with the status COLUMN — payload_json predates
  // the lifecycle and never carries it, so without this the UI can't tell a
  // draft (dead apply link) or a closed role from a live opening.
  return rows
    .map((r): JobRecord | null => {
      const parsed = safeRowParse<JobRecord>(r.payload_json, "listJobs");
      return parsed ? { ...parsed, status: r.status ?? null } : null;
    })
    .filter((j): j is JobRecord => j !== null);
}

export function getJob(id: string): JobRecord | null {
  const db = ensureDb();
  const row = db.prepare(`SELECT payload_json, status FROM jobs WHERE id = ?`).get(id) as
    | { payload_json: string; status: JobRecord["status"] }
    | undefined;
  if (!row) return null;
  const parsed = safeRowParse<JobRecord>(row.payload_json, "getJob", id);
  // Same status decoration as listJobs — the column is the lifecycle authority.
  return parsed ? { ...parsed, status: row.status ?? null } : null;
}

/** Batch getJob (idea-f946db9d): one IN-query — chunked under the SQLite
 *  variable limit, same pattern as interviewStatusByEntries — instead of one
 *  point SELECT per id. Returns records in the REQUESTED order; unknown ids and
 *  corrupt payloads (logged by safeRowParse) are skipped, matching getJob's
 *  per-row degradation. */
export function getJobsByIds(ids: string[]): JobRecord[] {
  if (ids.length === 0) return [];
  const db = ensureDb();
  const byId = new Map<string, JobRecord>();
  for (const part of chunk(ids, SQL_IN_CHUNK)) {
    const placeholders = part.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT id, payload_json FROM jobs WHERE id IN (${placeholders})`)
      .all(...part) as { id: string; payload_json: string }[];
    for (const r of rows) {
      const parsed = safeRowParse<JobRecord>(r.payload_json, "getJobsByIds", r.id);
      if (parsed) byId.set(r.id, parsed);
    }
  }
  return ids.map((id) => byId.get(id)).filter((j): j is JobRecord => j !== undefined);
}

// The full live job corpus — every current opening rematch scores against. Unlike
// listJobs (paginated, filtered, ranked for the browse UI) this returns ALL live
// jobs as full records, ordered by id, with drafts excluded (an unpublished JD is
// not a real opening). It backs the rematch path two ways at once: the caller
// fingerprints the sorted ids into the cache key AND hands the exact same set to
// the Python scorer, so the key provably tracks the corpus that was scored
// (idea-e01935e9). "Live" here MUST match the open-for-applications definition used
// by `openOnly` above and `isJobOpenForApplications` (job-ingest.ts): NULL = seeded/
// live, 'published' = live, everything else (draft AND closed) is held back. The old
// `status != 'draft'` kept 'closed' roles in the rematch corpus, so a recruiter who
// closed a filled role still had candidates ranked/routed to it — and the close didn't
// even change the cache fingerprint, persisting the stale result for the full TTL.
export function listCorpusJobs(): JobRecord[] {
  const db = ensureDb();
  const rows = db
    .prepare(`SELECT payload_json FROM jobs WHERE status IS NULL OR status = 'published' ORDER BY id`)
    .all() as { payload_json: string }[];
  return rows
    .map((r) => safeRowParse<JobRecord>(r.payload_json, "listCorpusJobs"))
    .filter((j): j is JobRecord => j !== null);
}

export type JobStats = {
  total: number;
  entryEligible: number;
  byRoleFamily: Record<string, number>;
  bySeniority: Record<string, number>;
  byWorkMode: Record<string, number>;
};

export function jobStats(): JobStats {
  const db = ensureDb();
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM jobs`).get() as { n: number }).n;
  const entryEligible = (
    db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE is_entry_eligible = 1`).get() as { n: number }
  ).n;
  // Column names are fixed literals (not user input) — safe to interpolate.
  const group = (col: "role_family" | "seniority" | "work_mode"): Record<string, number> => {
    const rows = db
      .prepare(`SELECT ${col} AS k, COUNT(*) AS n FROM jobs GROUP BY ${col} ORDER BY n DESC`)
      .all() as { k: string | null; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.k ?? "—", r.n]));
  };
  return {
    total,
    entryEligible,
    byRoleFamily: group("role_family"),
    bySeniority: group("seniority"),
    byWorkMode: group("work_mode"),
  };
}
