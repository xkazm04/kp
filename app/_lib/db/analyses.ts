import { ensureDb, insertWithUniqueSlug, prunePromptCache, safeRowParse } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";
import { githubAnalysisSchema, type GithubAnalysis } from "../schemas";
// EXPLICIT `.ts`, matching app/_lib/schemas.ts:2 — the repo's existing value import of
// this file. Extensionless works for the type-only imports elsewhere because those are
// erased before runtime, but a value import is resolved for real, and both the test
// alias loader and the 25 hand-rolled resolve hooks in *.test.ts treat the `.generated`
// in the basename as the extension, so neither ever tries appending `.ts`.
import { analysisResultSchema } from "../schemas.generated.ts";

export type AnalysisRow = {
  slug: string;
  candidate_label: string;
  jd_slug: string | null;
  score: number | null;
  role_family: string | null;
  seniority: string | null;
  payload_json: string;
  created_at: string;
  // RES5 — present on SELECTs that fetch them (loadAnalysis, listAnalyses);
  // optional because the narrower pool/JD SELECTs don't read them.
  disposition?: string | null;
  decision_note?: string | null;
  // SCOR2 — warn-shaped sanity-check count, same optionality rationale.
  review_flags?: number | null;
  // GH1 — attached GitHub deep-dive JSON, fetched only by loadAnalysis.
  github_json?: string | null;
  // Content-addressed candidate identity — SHA-256 of the CV bytes (see the
  // cv_hash migration in core.ts). Present on SELECTs that fetch it; NULL on rows
  // saved before the column existed. Fetched by the summary + detail reads below.
  cv_hash?: string | null;
};

// The recruiter dispositions a saved analysis can carry (RES5). advance/hold/pass
// mirror the language of the decision queue; "" clears the disposition.
export const ANALYSIS_DISPOSITIONS = ["advance", "hold", "pass"] as const;
export type AnalysisDisposition = (typeof ANALYSIS_DISPOSITIONS)[number];

export type AnalysisSummary = Omit<AnalysisRow, "payload_json">;

// listAnalyses collapses same-(cv_hash, jd_slug) re-runs to the newest row and
// reports how many older runs it stands in for, so a re-analyzed CV no longer
// accumulates duplicate History rows. `prior_runs` is COMPUTED (a count of the
// superseded rows), not a stored column; 0 for a first/only run or a legacy
// NULL-cv_hash row (which is never grouped). No row is ever deleted.
export type AnalysisListRow = AnalysisSummary & { prior_runs: number };

export type SaveAnalysisInput = {
  candidateLabel: string;
  jdSlug: string | null;
  score: number | null;
  roleFamily: string | null;
  seniority: string | null;
  payload: unknown;
  // Warn-shaped sanity-check count (countSanityWarns). Denormalized so the
  // History list can flag degraded analyses straight off the summary SELECT.
  reviewFlags?: number | null;
  // Content-addressed candidate identity — SHA-256 of the CV bytes, already
  // computed by the analyze intake (cvVariantHash). Threaded, not re-hashed.
  // Absent ⇒ NULL (the identity features degrade to per-row, never grouping).
  cvHash?: string | null;
};

// Tenant scope (P2): `workspaceId` defaults to the single workspace, so existing
// callers stay correct unchanged; the analyze task + primary request reads pass the
// real workspace. Stamps/filters every row by it.
export function saveAnalysis(input: SaveAnalysisInput, workspaceId: string = DEFAULT_WORKSPACE_ID): { slug: string; createdAt: string } {
  const db = ensureDb();
  const createdAt = new Date().toISOString();
  const payloadJson = JSON.stringify(input.payload);
  const stmt = db.prepare(
    `INSERT INTO analyses
      (slug, candidate_label, jd_slug, score, role_family, seniority, payload_json, created_at, review_flags, workspace_id, cv_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const slug = insertWithUniqueSlug((s) =>
    stmt.run(
      s,
      input.candidateLabel,
      input.jdSlug,
      input.score,
      input.roleFamily,
      input.seniority,
      payloadJson,
      createdAt,
      input.reviewFlags ?? null,
      workspaceId,
      input.cvHash ?? null
    )
  );
  return { slug, createdAt };
}

export function listAnalyses(limit = 100, workspaceId: string = DEFAULT_WORKSPACE_ID): AnalysisListRow[] {
  const db = ensureDb();
  // Content-addressed grouping: a re-run of the same CV (same cv_hash) against the
  // same JD used to add a fresh History row every time — duplicates piled up even
  // when the compute was a pure cache hit. We now return the NEWEST row per
  // (cv_hash, jd_slug) group and annotate it with prior_runs = how many older runs
  // it supersedes; NO row is deleted, so the older runs stay loadable by slug.
  //   - `a` is kept only when NO newer sibling exists in its group (the "is newest"
  //     NOT EXISTS predicate). Ties on created_at (same-millisecond re-runs) break by
  //     rowid — true insertion order — so "newest" is deterministic, not slug-random.
  //   - Grouping applies ONLY to non-NULL cv_hash rows; a legacy NULL-hash row has
  //     no siblings (a.cv_hash IS NULL makes every `= a.cv_hash` false), so it is
  //     always kept with prior_runs = 0 — behavior-identical to before for old data.
  //   - jd_slug is compared with `IS` (null-safe): two JD-less runs of the same CV
  //     group together; a CV run against different JDs does NOT.
  // Every subquery carries workspace_id (tenancy source guard) and matches a.workspace_id.
  const rows = db
    .prepare(
      `SELECT a.slug, a.candidate_label, a.jd_slug, a.score, a.role_family, a.seniority,
              a.created_at, a.disposition, a.decision_note, a.review_flags, a.cv_hash,
              (SELECT COUNT(*) FROM analyses p
                 WHERE p.workspace_id = a.workspace_id
                   AND a.cv_hash IS NOT NULL AND p.cv_hash = a.cv_hash
                   AND p.jd_slug IS a.jd_slug
                   AND (p.created_at < a.created_at
                        OR (p.created_at = a.created_at AND p.rowid < a.rowid))) AS prior_runs
       FROM analyses a
       WHERE a.workspace_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM analyses n
             WHERE n.workspace_id = a.workspace_id
               AND a.cv_hash IS NOT NULL AND n.cv_hash = a.cv_hash
               AND n.jd_slug IS a.jd_slug
               AND (n.created_at > a.created_at
                    OR (n.created_at = a.created_at AND n.rowid > a.rowid)))
       ORDER BY a.created_at DESC
       LIMIT ?`
    )
    .all(workspaceId, limit) as AnalysisListRow[];
  return rows;
}

// Cross-job linkage (content-addressed identity): every OTHER analysis of the
// SAME CV content (cv_hash) in this workspace, so the report can say "also
// analyzed for: …". Excludes the row being viewed and rows that share its JD
// (those are the same question, surfaced by History grouping instead). Newest
// first, bounded. Returns [] for a NULL/empty hash (nothing to link).
export function listAnalysesByCvHash(
  cvHash: string | null | undefined,
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  excludeSlug?: string,
  limit = 20
): AnalysisSummary[] {
  if (!cvHash) return [];
  const db = ensureDb();
  return db
    .prepare(
      `SELECT slug, candidate_label, jd_slug, score, role_family, seniority, created_at
       FROM analyses
       WHERE workspace_id = ? AND cv_hash = ? AND slug != ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(workspaceId, cvHash, excludeSlug ?? "", limit) as AnalysisSummary[];
}

// Profile ↔ CV lineage source: the content hash + analyzed-at timestamp of one
// saved analysis, by slug, so a profile built FROM it can stamp authoritative
// lineage (never client-supplied). Returns null when the slug doesn't resolve in
// this workspace, or when the analysis predates cv_hash (a NULL hash can't anchor
// staleness — the caller then leaves the profile's lineage NULL, never fabricated).
export function analysisLineageSource(
  slug: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): { slug: string; cvHash: string; analyzedAt: string } | null {
  const db = ensureDb();
  const row = db
    .prepare(`SELECT slug, cv_hash, created_at FROM analyses WHERE workspace_id = ? AND slug = ?`)
    .get(workspaceId, slug) as { slug: string; cv_hash: string | null; created_at: string } | undefined;
  if (!row || !row.cv_hash) return null;
  return { slug: row.slug, cvHash: row.cv_hash, analyzedAt: row.created_at };
}

// Label-collision probe: does another saved analysis in this workspace carry the
// SAME filename-derived candidate_label but a DIFFERENT CV content hash? That
// means two different people share a label (e.g. both files were "CV.pdf") — the
// report/History surfaces a caution so the recruiter isn't misled by the label.
// Requires a known cv_hash on both sides (NULL-hash legacy rows can't be judged).
export function hasLabelCollision(
  candidateLabel: string,
  cvHash: string | null | undefined,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): boolean {
  if (!cvHash) return false;
  const db = ensureDb();
  const row = db
    .prepare(
      `SELECT 1 FROM analyses
       WHERE workspace_id = ? AND candidate_label = ?
         AND cv_hash IS NOT NULL AND cv_hash != ?
       LIMIT 1`
    )
    .get(workspaceId, candidateLabel, cvHash);
  return row != null;
}

/** Record (or clear) the human disposition + note on a saved analysis (RES5).
 *  An empty/whitespace disposition clears both fields back to NULL. Returns false
 *  for an unknown slug. The display/storage is the analysis row itself — no event
 *  log, since an analysis isn't a pipeline entry. */
export function setAnalysisDisposition(slug: string, disposition: string, note: string, workspaceId: string = DEFAULT_WORKSPACE_ID): boolean {
  const db = ensureDb();
  const clean = (ANALYSIS_DISPOSITIONS as readonly string[]).includes(disposition) ? disposition : null;
  const noteVal = clean && note.trim() ? note.trim() : null;
  const res = db
    .prepare(`UPDATE analyses SET disposition = ?, decision_note = ? WHERE slug = ? AND workspace_id = ?`)
    .run(clean, clean ? noteVal : null, slug, workspaceId);
  return res.changes > 0;
}

// Calibration Engine (moonshot A/C, foundational primitive P1) — the first
// (prediction, outcome) dataset, computed entirely from existing columns. The
// PREDICTION is the saved 0-100 fit `score`; the OUTCOME is the recruiter
// `disposition` collapsed to a binary label (advance = 1, pass = 0). `hold` and
// an absent disposition are AMBIGUOUS by design — excluded, not scored as either,
// so the measured calibration isn't polluted by undecided rows. Read-only.
// `at` carries created_at so calibration can bucket into drift cohorts (Direction 1).
export type CalibrationPair = { score: number; outcome: 0 | 1; roleFamily: string | null; at: string };

export function calibrationPairs(workspaceId: string = DEFAULT_WORKSPACE_ID): CalibrationPair[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT score, disposition, role_family, created_at
       FROM analyses
       WHERE score IS NOT NULL AND disposition IN ('advance', 'pass') AND workspace_id = ?`
    )
    .all(workspaceId) as { score: number; disposition: string; role_family: string | null; created_at: string }[];
  return rows
    // Defensive: a NULL filter is in SQL, but guard a non-finite score (bad
    // migration / manual edit) so it never reaches the math as NaN.
    .filter((r) => Number.isFinite(r.score))
    .map((r) => ({
      score: r.score,
      outcome: r.disposition === "advance" ? 1 : 0,
      roleFamily: r.role_family,
      at: r.created_at,
    }));
}

// Direction 2 — the analyses behind ONE calibration score band, workspace-scoped.
// Same inclusion rule as calibrationPairs (advance = 1, pass = 0; hold/undecided
// excluded). An analysis isn't a board entry, so there's no live entry id — the
// panel links each by candidate label through the board's existing text filter.
export type CalibrationBandAnalysis = { slug: string; label: string; score: number; outcome: 0 | 1; roleFamily: string | null };

export function analysisCalibrationBandCandidates(
  loPct: number,
  hiPct: number,
  inclusiveHi: boolean,
  roleFamily: string | null,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): CalibrationBandAnalysis[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT slug, candidate_label, score, disposition, role_family FROM analyses
       WHERE score IS NOT NULL AND disposition IN ('advance', 'pass') AND workspace_id = ?
         AND score >= ? AND (score < ? ${inclusiveHi ? "OR score = ?" : ""})
       ORDER BY score DESC, candidate_label ASC`
    )
    .all(...(inclusiveHi ? [workspaceId, loPct, hiPct, hiPct] : [workspaceId, loPct, hiPct])) as {
    slug: string;
    candidate_label: string;
    score: number;
    disposition: string;
    role_family: string | null;
  }[];
  return rows
    .filter((r) => Number.isFinite(r.score) && (!roleFamily || r.role_family === roleFamily))
    .map((r) => ({
      slug: r.slug,
      label: r.candidate_label,
      score: r.score,
      outcome: (r.disposition === "advance" ? 1 : 0) as 0 | 1,
      roleFamily: r.role_family,
    }));
}

// Canonical match-score read path (REC-01 / OO-L2-10, see app/_lib/match-score.ts):
// every scored, JD-tagged analysis, newest first, so the resolver
// (match-score-resolve.ts) can keep the FRESHEST fit per (candidate label, jd slug)
// with a single query instead of a per-entry N+1. Bounded: the resolver only needs
// the newest row per pair, and pairs beyond the cap are older than anything a live
// pipeline entry would reference.
export type JdFitRow = {
  candidate_label: string;
  jd_slug: string;
  score: number;
  created_at: string;
  slug: string;
};

export function listJdFitRows(workspaceId: string = DEFAULT_WORKSPACE_ID, limit = 1000): JdFitRow[] {
  const db = ensureDb();
  return db
    .prepare(
      `SELECT candidate_label, jd_slug, score, created_at, slug
       FROM analyses
       WHERE jd_slug IS NOT NULL AND score IS NOT NULL AND workspace_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(workspaceId, limit) as JdFitRow[];
}

/** Freshest analysis slug per candidate label (case-insensitive), regardless of
 *  JD targeting — the label-level fallback the decisions peer-context join uses
 *  for CANDIDATE-level facts (salary expectation, declared skills) when no
 *  (label, jd_slug)-strict analysis exists. Per-JD facts must NOT be read
 *  through this map — a jobFit computed against another role would lie. */
export function freshestAnalysisSlugByLabel(workspaceId: string = DEFAULT_WORKSPACE_ID, limit = 1000): Map<string, string> {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT candidate_label, slug FROM analyses
       WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(workspaceId, limit) as { candidate_label: string; slug: string }[];
  const out = new Map<string, string>();
  for (const row of rows) {
    const key = row.candidate_label.trim().toLowerCase();
    if (!out.has(key)) out.set(key, row.slug);
  }
  return out;
}

// Every analysis tagged with a JD slug, ordered best-score-first. Uses the
// idx_analyses_jd_slug index — no row cap and no in-memory filter, so the JD
// page's candidate count stays correct even past 500 total analyses.
export function listAnalysesByJd(slug: string, workspaceId: string = DEFAULT_WORKSPACE_ID): AnalysisSummary[] {
  const db = ensureDb();
  return db
    .prepare(
      `SELECT slug, candidate_label, jd_slug, score, role_family, seniority, created_at
       FROM analyses
       WHERE jd_slug = ? AND workspace_id = ?
       ORDER BY score DESC, created_at DESC`
    )
    .all(slug, workspaceId) as AnalysisSummary[];
}

// Analyzed-candidate count per JD slug, one GROUP BY for the whole library —
// the Library tab's per-row "Candidates (N)" toggle needs every count up front
// without firing a per-row listAnalysesByJd N+1. Workspace-scoped like the list.
export function countAnalysesByJd(workspaceId: string = DEFAULT_WORKSPACE_ID): Record<string, number> {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT jd_slug, COUNT(*) AS n FROM analyses
       WHERE jd_slug IS NOT NULL AND workspace_id = ? GROUP BY jd_slug`
    )
    .all(workspaceId) as { jd_slug: string; n: number }[];
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.jd_slug] = row.n;
  return counts;
}

// Like listAnalyses but folds payload_json into the one query, so callers that
// need every payload (e.g. the candidate pool) don't fire an N+1 of loadAnalysis.
export function listAnalysisRecords(limit = 100, workspaceId: string = DEFAULT_WORKSPACE_ID): { row: AnalysisRow; payload: unknown }[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT slug, candidate_label, jd_slug, score, role_family, seniority, payload_json, created_at
       FROM analyses WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(workspaceId, limit) as AnalysisRow[];
  const out: { row: AnalysisRow; payload: unknown }[] = [];
  for (const row of rows) {
    // OBSERVE, not enforce — deliberately, and with a measured reason. As of 2026-08-28,
    // 50 of 121 stored analyses fail analysisResultSchema: every `cv-` row written by the
    // Gemini CV-analysis path omits `keywordCoverage.hits[].status`, which the Python
    // AnalysisResult model declares as a required enum (403 hits affected). That is real
    // writer-vs-declaration drift, invisible until now because this layer only ever used
    // the generated TYPE and never called the generated SCHEMA. Enforcing here would drop
    // 41% of the list — turning a data defect into an outage. Observe records every
    // mismatch in getRowHealth() so the drift is measurable while the writer is fixed;
    // graduate this to enforce once the ledger is clean.
    const payload = safeRowParse(row.payload_json, "listAnalysisRecords", row.slug, analysisResultSchema, "observe");
    if (payload == null) continue; // corrupt row already logged by safeRowParse; degrade to N-1
    out.push({ row, payload });
  }
  return out;
}

/** Attach (or replace) the GitHub deep-dive payload on a saved analysis (GH1).
 *  The caller (PATCH route) validates the shape; this stores the JSON string.
 *  Returns false for an unknown slug. */
export function setAnalysisGithub(slug: string, githubJson: string, workspaceId: string = DEFAULT_WORKSPACE_ID): boolean {
  const db = ensureDb();
  const res = db.prepare(`UPDATE analyses SET github_json = ? WHERE slug = ? AND workspace_id = ?`).run(githubJson, slug, workspaceId);
  return res.changes > 0;
}

export function loadAnalysis(slug: string, workspaceId: string = DEFAULT_WORKSPACE_ID): { row: AnalysisRow; payload: unknown } | null {
  const db = ensureDb();
  const row = db
    .prepare(
      `SELECT slug, candidate_label, jd_slug, score, role_family, seniority, payload_json, created_at, disposition, decision_note, github_json, cv_hash
       FROM analyses WHERE slug = ? AND workspace_id = ?`
    )
    .get(slug, workspaceId) as AnalysisRow | undefined;
  if (!row) return null;
  const payload = safeRowParse(row.payload_json, "loadAnalysis", slug);
  if (payload == null) return null;
  return { row, payload };
}

// GH1 — defensively revive the persisted GitHub deep-dive from the analyses
// `github_json` column. Both the API read route and the saved-report history page
// re-implemented this guard (parse → schema-validate → log → degrade to nothing on
// any corruption). Single-sourced here so the "a corrupt column must never crash,
// just drop the GitHub tab" contract lives in one place. Returns null for an
// absent/corrupt/older-schema payload, never throws.
export function parseStoredGithubAnalysis(
  githubJson: string | null | undefined,
  slug: string
): GithubAnalysis | null {
  if (!githubJson) return null;
  try {
    const parsed = githubAnalysisSchema.safeParse(JSON.parse(githubJson));
    return parsed.success ? parsed.data : null;
  } catch (error) {
    console.error(`[db:analyses] corrupt github_json on "${slug}"`, error);
    return null;
  }
}

type CacheRow = {
  hash: string;
  payload_json: string;
  prompt_version: string;
  expires_at: string;
};

// Fraction of cache writes that also trigger an opportunistic prune. Combined
// with the boot prune in ensureDb, this keeps the prompt cache bounded on a
// long-running deployment without any scheduler dependency — every distinct
// analyze input adds a row, so spreading the GC across writes amortizes it.
const CACHE_PRUNE_PROBABILITY = 0.02;

// Generic prompt cache (analyze, per-match reasoning, automation tasks). The
// backing table is named `gemini_cache` for historical reasons — the real
// provider is ClaudeCliProvider, not Gemini — kept as-is to avoid orphaning the
// cached rows on existing deployments; the function names carry the accurate name.
export function lookupPromptCache(hash: string, promptVersion: string): unknown | null {
  const db = ensureDb();
  const row = db
    .prepare(
      `SELECT hash, payload_json, prompt_version, expires_at
       FROM gemini_cache WHERE hash = ?`
    )
    .get(hash) as CacheRow | undefined;
  if (!row) return null;
  if (row.prompt_version !== promptVersion) return null;
  // Fail closed: a non-finite parsed expiry (corruption, a bad migration default,
  // a manual edit) counts as already-expired, so a garbage timestamp self-heals into
  // a harmless miss instead of being served as an indefinitely-stale cache HIT.
  const expiresAt = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;
  // A corrupt cache payload logs (with the hash) and reads as a miss, same as a
  // miss — never an error served as a 200.
  return safeRowParse(row.payload_json, "lookupPromptCache", hash);
}

export function storePromptCache(
  hash: string,
  payload: unknown,
  promptVersion: string,
  ttlHours: number
): void {
  const db = ensureDb();
  const now = new Date();
  const expires = new Date(now.getTime() + ttlHours * 3600 * 1000);
  db.prepare(
    `INSERT INTO gemini_cache (hash, payload_json, prompt_version, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(hash) DO UPDATE SET
       payload_json = excluded.payload_json,
       prompt_version = excluded.prompt_version,
       created_at = excluded.created_at,
       expires_at = excluded.expires_at`
  ).run(hash, JSON.stringify(payload), promptVersion, now.toISOString(), expires.toISOString());
  // Opportunistic GC on a small fraction of writes so expired rows are
  // reclaimed during normal operation, not only at boot. Best-effort: a prune
  // failure must never fail the write that just succeeded.
  if (Math.random() < CACHE_PRUNE_PROBABILITY) {
    try {
      // Bound the opportunistic prune: it fires on a user-facing write path, so an
      // unbounded DELETE over a large expired backlog would hold the write lock for
      // seconds and stall (SQLITE_BUSY) concurrent storePromptCache/scheduler writes.
      // The boot prune stays unbounded but runs off the hot path.
      prunePromptCache(500);
    } catch (error) {
      console.error("[db] prompt-cache opportunistic prune failed", error);
    }
  }
}

// DATA2 — prompt-cache visibility for the ops panel: live row count plus the
// expired backlog the bounded opportunistic prune hasn't reclaimed yet.
export function promptCacheStats(): { rows: number; expiredBacklog: number } {
  const db = ensureDb();
  const now = new Date().toISOString();
  const rows = (db.prepare(`SELECT COUNT(*) AS n FROM gemini_cache`).get() as { n: number }).n;
  const expired = (db.prepare(`SELECT COUNT(*) AS n FROM gemini_cache WHERE expires_at < ?`).get(now) as { n: number }).n;
  return { rows, expiredBacklog: expired };
}
