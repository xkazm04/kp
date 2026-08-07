import { ensureDb, insertWithUniqueSlug, prunePromptCache, safeRowParse } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";
import { githubAnalysisSchema, type GithubAnalysis } from "../schemas";

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
};

// The recruiter dispositions a saved analysis can carry (RES5). advance/hold/pass
// mirror the language of the decision queue; "" clears the disposition.
export const ANALYSIS_DISPOSITIONS = ["advance", "hold", "pass"] as const;
export type AnalysisDisposition = (typeof ANALYSIS_DISPOSITIONS)[number];

export type AnalysisSummary = Omit<AnalysisRow, "payload_json">;

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
      (slug, candidate_label, jd_slug, score, role_family, seniority, payload_json, created_at, review_flags, workspace_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      workspaceId
    )
  );
  return { slug, createdAt };
}

export function listAnalyses(limit = 100, workspaceId: string = DEFAULT_WORKSPACE_ID): AnalysisSummary[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT slug, candidate_label, jd_slug, score, role_family, seniority, created_at, disposition, decision_note, review_flags
       FROM analyses
       WHERE workspace_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(workspaceId, limit) as AnalysisSummary[];
  return rows;
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
export type CalibrationPair = { score: number; outcome: 0 | 1; roleFamily: string | null };

export function calibrationPairs(workspaceId: string = DEFAULT_WORKSPACE_ID): CalibrationPair[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT score, disposition, role_family
       FROM analyses
       WHERE score IS NOT NULL AND disposition IN ('advance', 'pass') AND workspace_id = ?`
    )
    .all(workspaceId) as { score: number; disposition: string; role_family: string | null }[];
  return rows
    // Defensive: a NULL filter is in SQL, but guard a non-finite score (bad
    // migration / manual edit) so it never reaches the math as NaN.
    .filter((r) => Number.isFinite(r.score))
    .map((r) => ({
      score: r.score,
      outcome: r.disposition === "advance" ? 1 : 0,
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
    const payload = safeRowParse(row.payload_json, "listAnalysisRecords", row.slug);
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
      `SELECT slug, candidate_label, jd_slug, score, role_family, seniority, payload_json, created_at, disposition, decision_note, github_json
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
