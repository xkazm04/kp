import { chunk, SQL_IN_CHUNK } from "../entries-param";
import { ensureDb, insertWithUniqueSlug, safeRowParse, type JobRecord } from "./core";

export type JdRow = {
  slug: string;
  title: string;
  body: string;
  created_at: string;
  // W8-4 — set when archived; loadJd still serves the row (banner, no 404).
  archived_at?: string | null;
};

// What the list endpoint exposes: identity + a short, server-truncated preview
// instead of the full body, so the list response stays bounded no matter how
// large individual JD bodies grow. Full bodies remain behind loadJd /
// GET /api/jds/[slug].
export type JdListItem = {
  slug: string;
  title: string;
  preview: string;
  created_at: string;
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

export function listJds(limit = 100): JdListItem[] {
  const db = ensureDb();
  // Pull only one char past the preview window to detect truncation, so the
  // full body is never read into memory for the list view.
  const rows = db
    .prepare(
      `SELECT slug, title, created_at,
              substr(body, 1, ${JD_PREVIEW_CHARS + 1}) AS body_head,
              length(body) AS body_len
       FROM jds WHERE archived_at IS NULL ORDER BY created_at DESC LIMIT ?`
    )
    .all(limit) as Array<{
    slug: string;
    title: string;
    created_at: string;
    body_head: string;
    body_len: number;
  }>;
  return rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    created_at: r.created_at,
    preview: r.body_len > JD_PREVIEW_CHARS ? `${r.body_head.slice(0, JD_PREVIEW_CHARS)}…` : r.body_head,
  }));
}

export function loadJd(slug: string): JdRow | null {
  const db = ensureDb();
  // Archived rows still load (W8-4): the public page renders them with a
  // banner so existing analysis/report links never 404.
  const row = db
    .prepare(`SELECT slug, title, body, created_at, archived_at FROM jds WHERE slug = ?`)
    .get(slug) as JdRow | undefined;
  return row ?? null;
}

/** Edit a saved JD in place (W8-4/JDL1 — the library was fully append-only, so
 *  every revision forked a permanent near-duplicate and orphaned the analysis
 *  history keyed on jd_slug). Caller validates via validateJdFields. */
export function updateJd(slug: string, input: { title: string; body: string }): boolean {
  const db = ensureDb();
  // Snapshot the PRE-edit version into jd_revisions first (idea-6a18e0fc), in one
  // transaction with the overwrite, so an edit is always recoverable.
  const tx = db.transaction((): boolean => {
    const current = db.prepare(`SELECT title, body FROM jds WHERE slug = ?`).get(slug) as
      | { title: string; body: string }
      | undefined;
    if (!current) return false;
    db.prepare(`INSERT INTO jd_revisions (slug, title, body, created_at) VALUES (?, ?, ?, ?)`).run(
      slug,
      current.title,
      current.body,
      new Date().toISOString()
    );
    return db.prepare(`UPDATE jds SET title = ?, body = ? WHERE slug = ?`).run(input.title, input.body, slug).changes > 0;
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

/** Restore a JD to a prior revision (idea-6a18e0fc). Snapshots the CURRENT version
 *  first (a revert is itself an edit, so it's undoable too), then overwrites.
 *  Returns the restored {title, body}, or null if the revision/JD is missing. */
export function revertJd(slug: string, revisionId: number): { title: string; body: string } | null {
  const db = ensureDb();
  const tx = db.transaction((): { title: string; body: string } | null => {
    const rev = db.prepare(`SELECT title, body FROM jd_revisions WHERE id = ? AND slug = ?`).get(revisionId, slug) as
      | { title: string; body: string }
      | undefined;
    const current = db.prepare(`SELECT title, body FROM jds WHERE slug = ?`).get(slug) as
      | { title: string; body: string }
      | undefined;
    if (!rev || !current) return null;
    db.prepare(`INSERT INTO jd_revisions (slug, title, body, created_at) VALUES (?, ?, ?, ?)`).run(
      slug,
      current.title,
      current.body,
      new Date().toISOString()
    );
    db.prepare(`UPDATE jds SET title = ?, body = ? WHERE slug = ?`).run(rev.title, rev.body, slug);
    return { title: rev.title, body: rev.body };
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
      `SELECT payload_json FROM jobs ${clause}
       ORDER BY is_entry_eligible DESC, graduate_friendliness DESC, id LIMIT @limit`
    )
    .all(params) as { payload_json: string }[];
  return rows
    .map((r) => safeRowParse<JobRecord>(r.payload_json, "listJobs"))
    .filter((j): j is JobRecord => j !== null);
}

export function getJob(id: string): JobRecord | null {
  const db = ensureDb();
  const row = db.prepare(`SELECT payload_json FROM jobs WHERE id = ?`).get(id) as
    | { payload_json: string }
    | undefined;
  return row ? safeRowParse<JobRecord>(row.payload_json, "getJob", id) : null;
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
// (idea-e01935e9). NULL status = seeded/live corpus job; 'published' = live; only
// 'draft' is held back.
export function listCorpusJobs(): JobRecord[] {
  const db = ensureDb();
  const rows = db
    .prepare(`SELECT payload_json FROM jobs WHERE status IS NULL OR status != 'draft' ORDER BY id`)
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
