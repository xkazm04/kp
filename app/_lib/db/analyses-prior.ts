// Database slice for prior-run footprint queries.
// Isolated from analyses.ts so prior-run checks do not depend on the large analyses barrel
// and can be maintained independently.
import { ensureDb } from "./core.ts";

export type PriorRunDbRow = {
  slug: string;
  candidate_label: string;
  jd_slug: string | null;
  score: number | null;
  created_at: string;
  disposition: string | null;
  cv_hash: string | null;
};

/**
 * List prior analysis runs matching any of the given CV hashes in the workspace,
 * ordered newest first.
 * Every query carries an explicit bound workspace_id = ? predicate.
 */
export function listPriorRunsByCvHashes(
  hashes: readonly string[],
  workspaceId: string,
  limit = 20
): PriorRunDbRow[] {
  if (hashes.length === 0) return [];
  const db = ensureDb();
  const placeholders = hashes.map(() => "?").join(", ");
  const stmt = db.prepare(
    `SELECT slug, candidate_label, jd_slug, score, created_at, disposition, cv_hash
     FROM analyses
     WHERE workspace_id = ? AND cv_hash IN (${placeholders})
     ORDER BY created_at DESC, rowid DESC
     LIMIT ?`
  );
  return stmt.all(workspaceId, ...hashes, limit) as PriorRunDbRow[];
}
