import { ensureDb, insertWithUniqueSlug, safeRowParse } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";
import { maskCandidateName, scrubPiiFromPayload } from "../consent";
import { createTtlCache } from "../analytics-cache";

// ---- Candidate profiles (v2 archetype-aware intake) -----------------------

// Shared list ceiling for the Profile-tab reads — the roster (/api/profile) and
// the matrix (/api/profile/candidates) both page the same 200, so centralize it
// and the memo below keys on it implicitly (both routes read the same set).
export const PROFILE_LIST_LIMIT = 200;

export type ProfileRow = {
  id: string;
  label: string;
  archetype: string | null;
  role_family: string | null;
  completeness: number | null;
  created_at: string;
};

export type SaveProfileInput = {
  label: string;
  archetype: string | null;
  roleFamily: string | null;
  completeness: number | null;
  payload: unknown;
};

// Source lineage stamped on a profile built FROM a saved CV analysis. Resolved
// server-side from the source analysis (analysisLineageSource) — never accepted
// raw from the client. `analyzedAt` is that analysis's created_at, so staleness
// survives even if the source analysis is later superseded/deleted.
export type ProfileLineage = { sourceAnalysisSlug: string; sourceCvHash: string; sourceAnalyzedAt: string };

// One profile flagged stale: a NEWER analysis of the SAME CV content exists in the
// workspace than the one this profile was built from. Carries the newer analysis's
// slug (the rebuild target) and its analyzed-at date (the badge's title).
export type ProfileStaleness = { newerSlug: string; newerAnalyzedAt: string };

// Tenant scope (P2): `workspaceId` defaults to the single workspace (behavior-
// preserving; existing/candidate/task callers stay correct). INSERT stamps it;
// SELECT/UPDATE/DELETE filter by it.
export function saveProfile(
  input: SaveProfileInput,
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  // Source lineage when this profile is built FROM a saved analysis; omitted for a
  // hand-built profile (all three columns stay NULL — never fabricated).
  lineage?: ProfileLineage
): { id: string; createdAt: string } {
  const db = ensureDb();
  const createdAt = new Date().toISOString();
  const payloadJson = JSON.stringify(input.payload);
  const stmt = db.prepare(
    `INSERT INTO profiles
       (id, label, archetype, role_family, completeness, payload_json, created_at, workspace_id,
        source_analysis_slug, source_cv_hash, source_analyzed_at, updated_at, lineage_stamped_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const id = insertWithUniqueSlug((s) =>
    stmt.run(
      s,
      input.label,
      input.archetype,
      input.roleFamily,
      input.completeness,
      payloadJson,
      createdAt,
      workspaceId,
      lineage?.sourceAnalysisSlug ?? null,
      lineage?.sourceCvHash ?? null,
      lineage?.sourceAnalyzedAt ?? null,
      // updated_at seeds equal to created_at (no edit yet). lineage_stamped_at is set
      // only when this is a build-from-analysis — so updated_at == lineage_stamped_at
      // at birth (never diverged) and stays NULL/uncompared for a hand-built profile.
      createdAt,
      lineage ? createdAt : null
    )
  );
  invalidateProfileRecordsCache();
  return { id, createdAt };
}

export function listProfiles(limit = 100, workspaceId: string = DEFAULT_WORKSPACE_ID): ProfileRow[] {
  const db = ensureDb();
  return db
    .prepare(
      `SELECT id, label, archetype, role_family, completeness, created_at
       FROM profiles WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(workspaceId, limit) as ProfileRow[];
}

// Like listProfiles but folds payload_json into the one query, so callers that
// need every payload (e.g. the candidate pool) don't fire an N+1 of getProfileRecord.
export function listProfileRecords(limit = 100, workspaceId: string = DEFAULT_WORKSPACE_ID): { row: ProfileRow; payload: unknown }[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT id, label, archetype, role_family, completeness, payload_json, created_at
       FROM profiles WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(workspaceId, limit) as (ProfileRow & { payload_json: string })[];
  const out: { row: ProfileRow; payload: unknown }[] = [];
  for (const r of rows) {
    const { payload_json, ...rest } = r;
    const payload = safeRowParse(payload_json, "listProfileRecords", rest.id);
    if (payload == null) continue; // corrupt row already logged by safeRowParse; degrade to N-1
    out.push({ row: rest, payload });
  }
  return out;
}

// Short-TTL per-workspace memo for the profile-records read that BOTH Profile-tab
// endpoints share: /api/profile (roster, projects to ProfileRow) and
// /api/profile/candidates (matrix, needs the payload) each read the profiles table
// on the SAME tab load — so within the TTL the second read is served from memory,
// making the tab's double profile-fetch a single DB read. Same idiom + reasoning as
// analytics-cache; keyed workspace-first, so no set ever crosses tenants.
//
// UNLIKE the analytics memo, this one IS write-invalidated: a create/edit/delete
// must reflect on the very next read (the roster's optimistic prune + the matrix's
// forced refetch would otherwise show a just-deleted row for up to the TTL). Every
// profiles write below clears it — cheap, since writes are rare next to these reads.
const profileRecordsCache = createTtlCache<{ row: ProfileRow; payload: unknown }[]>();

/** The workspace's profile records, memoized for a short TTL. Both Profile-tab
 *  routes call this so the second read on a tab load is free. Byte-identical to
 *  listProfileRecords(PROFILE_LIST_LIMIT, ws) — the roster projects `.row` off it. */
export function cachedProfileRecords(workspaceId: string = DEFAULT_WORKSPACE_ID): { row: ProfileRow; payload: unknown }[] {
  return profileRecordsCache.get(workspaceId, () => listProfileRecords(PROFILE_LIST_LIMIT, workspaceId));
}

/** Drop the profile-records memo (all workspaces). Called by every profiles write so
 *  the next read reflects it immediately. Exposed for tests that assert freshness. */
export function invalidateProfileRecordsCache(): void {
  profileRecordsCache.clear();
}

export function getProfileRecord(id: string, workspaceId: string = DEFAULT_WORKSPACE_ID): { row: ProfileRow; payload: unknown } | null {
  const db = ensureDb();
  const row = db
    .prepare(
      `SELECT id, label, archetype, role_family, completeness, payload_json, created_at
       FROM profiles WHERE id = ? AND workspace_id = ?`
    )
    .get(id, workspaceId) as (ProfileRow & { payload_json: string }) | undefined;
  if (!row) return null;
  const { payload_json, ...rest } = row;
  const payload = safeRowParse(payload_json, "getProfileRecord", rest.id);
  if (payload == null) return null;
  return { row: rest, payload };
}

// Overwrite an existing profile in place (created_at is preserved so the roster
// keeps its order; the payload is the freshly re-routed/re-scored profile from
// profile_cli). Returns false when no row matched the id.
export function updateProfile(id: string, input: SaveProfileInput, workspaceId: string = DEFAULT_WORKSPACE_ID): boolean {
  const db = ensureDb();
  // Stamp updated_at on every content write. lineage_stamped_at is left untouched
  // (only setProfileLineage moves it) — so an edit AFTER a build/rebuild pushes
  // updated_at past lineage_stamped_at, which is exactly the divergence signal a
  // rebuild reads before it clobbers the recruiter's edits.
  const info = db
    .prepare(
      `UPDATE profiles SET label = ?, archetype = ?, role_family = ?, completeness = ?, payload_json = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`
    )
    .run(input.label, input.archetype, input.roleFamily, input.completeness, JSON.stringify(input.payload), new Date().toISOString(), id, workspaceId);
  invalidateProfileRecordsCache();
  return Number(info.changes) > 0;
}

// A profile's divergence from its source analysis: has it been hand-edited SINCE it
// was built/rebuilt from that analysis? Compares the content-write stamp (updated_at)
// against the lineage stamp (lineage_stamped_at). `diverged` is true only when BOTH
// are present and the edit is strictly newer — a legacy row (NULL stamps) or an
// un-edited build reports `diverged:false`, so rebuild behaves exactly as before.
// `editedAt` is the updated_at the warning names. Returns null when the id is unknown.
export type ProfileDivergence = { diverged: boolean; editedAt: string | null };
export function profileDivergence(id: string, workspaceId: string = DEFAULT_WORKSPACE_ID): ProfileDivergence | null {
  const db = ensureDb();
  const row = db
    .prepare(`SELECT updated_at, lineage_stamped_at FROM profiles WHERE id = ? AND workspace_id = ?`)
    .get(id, workspaceId) as { updated_at: string | null; lineage_stamped_at: string | null } | undefined;
  if (!row) return null;
  // ISO-8601 timestamps compare lexicographically, so `>` is a chronological "is newer"
  // — the same equivalence profileStaleness relies on.
  const diverged = row.updated_at != null && row.lineage_stamped_at != null && row.updated_at > row.lineage_stamped_at;
  return { diverged, editedAt: row.updated_at };
}

// Stamp (or refresh) a profile's source lineage in place — the rebuild-from-latest
// flow re-points an existing profile at a NEWER same-CV analysis. Kept SEPARATE
// from updateProfile so a plain edit (or the GDPR anonymize pass, which also calls
// updateProfile) can NEVER accidentally wipe or forge lineage — only an explicit
// rebuild touches these columns. Returns false when no row matched the id.
export function setProfileLineage(id: string, lineage: ProfileLineage, workspaceId: string = DEFAULT_WORKSPACE_ID): boolean {
  const db = ensureDb();
  // Also move lineage_stamped_at to now: this rebuild re-anchors the profile to its
  // (newer) analysis, so any prior edit no longer counts as divergence. On the rebuild
  // path updateProfile has just run (updated_at ≤ now), so post-rebuild
  // updated_at ≤ lineage_stamped_at ⇒ not diverged — the rebuilt profile is clean.
  const info = db
    .prepare(
      `UPDATE profiles SET source_analysis_slug = ?, source_cv_hash = ?, source_analyzed_at = ?, lineage_stamped_at = ?
       WHERE id = ? AND workspace_id = ?`
    )
    .run(lineage.sourceAnalysisSlug, lineage.sourceCvHash, lineage.sourceAnalyzedAt, new Date().toISOString(), id, workspaceId);
  invalidateProfileRecordsCache();
  return Number(info.changes) > 0;
}

// Profile ↔ CV staleness (workspace-scoped): for every profile that carries source
// lineage, is there a NEWER analysis of the SAME CV content than the one it was
// built from? A profile with NULL lineage is skipped entirely (no false staleness
// on a hand-built profile). Returns a map keyed by profile id, present ONLY for
// stale profiles — the newer analysis's slug (the rebuild target) and its analyzed
// date. Computed in a SINGLE join (see below) rather than a per-profile loop, so
// the cost is one query regardless of how many lineage profiles exist.
export function profileStaleness(workspaceId: string = DEFAULT_WORKSPACE_ID): Record<string, ProfileStaleness> {
  const db = ensureDb();
  // ONE query instead of the old N+1 (one listAnalysesByCvHash per lineage-bearing
  // profile, run on EVERY GET /api/profile). Join each lineage profile to the
  // NEWER same-CV analyses in its workspace and keep, per profile, the newest —
  // the exact result the loop produced: listAnalysesByCvHash already took the
  // MAX(created_at) analysis (≠ the source slug); if that max exceeds the source's
  // analyzed-at it IS the max of the "strictly newer" subset, so filtering in the
  // JOIN and taking the top row is equivalent. ISO-8601 timestamps compare
  // lexicographically, so `>` is a chronological "is newer".
  //
  // COALESCE(source_analysis_slug, '') mirrors the old excludeSlug ?? "" — a NULL
  // source slug excludes nothing (no analysis slug is ""), so a lineage profile
  // whose source slug is somehow NULL still resolves its newer analyses.
  // ROW_NUMBER's slug-DESC tiebreak makes an exact-timestamp tie deterministic
  // (the old LIMIT-1 tiebreak was arbitrary; ties don't occur with distinct saves).
  const rows = db
    .prepare(
      `SELECT id, newerSlug, newerAnalyzedAt FROM (
         SELECT p.id AS id,
                a.slug AS newerSlug,
                a.created_at AS newerAnalyzedAt,
                ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY a.created_at DESC, a.slug DESC) AS rn
         FROM profiles p
         JOIN analyses a
           ON a.workspace_id = p.workspace_id
          AND a.cv_hash = p.source_cv_hash
          AND a.slug <> COALESCE(p.source_analysis_slug, '')
          AND a.created_at > p.source_analyzed_at
         WHERE p.workspace_id = ?
           AND p.source_cv_hash IS NOT NULL
           AND p.source_analyzed_at IS NOT NULL
       ) WHERE rn = 1`
    )
    .all(workspaceId) as { id: string; newerSlug: string; newerAnalyzedAt: string }[];
  const out: Record<string, ProfileStaleness> = {};
  for (const r of rows) out[r.id] = { newerSlug: r.newerSlug, newerAnalyzedAt: r.newerAnalyzedAt };
  return out;
}

// GDPR anonymization of a profile (consent expiry / erasure): mask the label and
// deep-scrub directly-identifying PII out of the stored CV payload (name, raw CV
// text, contact, evidence quotes) while KEEPING the scoring signal (skills, score,
// seniority) so a retained, de-identified record can still be ranked. NOT a delete
// — the profile row survives anonymized. Workspace-agnostic by design: the caller
// (anonymizeEntry) resolves the row by id across the default tenant. Returns false
// when no row matched. Idempotent (re-running over a scrubbed payload is a no-op).
export function anonymizeProfile(id: string, workspaceId: string = DEFAULT_WORKSPACE_ID): boolean {
  // Compose the existing tenant-scoped primitives (never raw profiles SQL — the
  // profiles-tenancy guard requires every statement to carry workspace_id).
  const rec = getProfileRecord(id, workspaceId);
  if (!rec) return false;
  return updateProfile(
    id,
    {
      label: maskCandidateName(rec.row.label),
      archetype: rec.row.archetype,
      roleFamily: rec.row.role_family,
      completeness: rec.row.completeness ?? 0,
      payload: scrubPiiFromPayload(rec.payload),
    },
    workspaceId
  );
}

// Returns false when no row matched the id. Pipeline entries reference a profile
// by candidateId but hold their own denormalized label/archetype, so a delete
// here does not cascade — an already-converted candidate stays in the pipeline.
export function deleteProfile(id: string, workspaceId: string = DEFAULT_WORKSPACE_ID): boolean {
  const db = ensureDb();
  const info = db.prepare(`DELETE FROM profiles WHERE id = ? AND workspace_id = ?`).run(id, workspaceId);
  invalidateProfileRecordsCache();
  return Number(info.changes) > 0;
}

// ---- Fit matrix (Phase 16) ------------------------------------------------

export type MatrixProfile = { id: string; label: string; archetype: string | null; payload: unknown };

// Hard ceiling on how many candidates the Fit Matrix scores per request. The grid
// is an O(N*M) Python spawn, so an unbounded pool would blow the request budget on
// a large workspace. The route surfaces the unclamped total (countMatrixProfiles)
// alongside this cap so the UI can say "Showing 200 of N" rather than silently
// omitting rows past the cap (skill-matrix-coverage #1).
export const MATRIX_POOL_CAP = 200;

/** How many candidate profiles the workspace has (unclamped) — so the matrix route
 *  can report the true pool size against MATRIX_POOL_CAP. */
export function countMatrixProfiles(workspaceId: string = DEFAULT_WORKSPACE_ID): number {
  const db = ensureDb();
  const row = db.prepare(`SELECT COUNT(*) AS n FROM profiles WHERE workspace_id = ?`).get(workspaceId) as { n: number };
  return row.n;
}

export function listMatrixProfiles(limit = MATRIX_POOL_CAP, workspaceId: string = DEFAULT_WORKSPACE_ID): MatrixProfile[] {
  const db = ensureDb();
  const rows = db
    .prepare(`SELECT id, label, archetype, payload_json FROM profiles WHERE workspace_id = ? ORDER BY created_at ASC LIMIT ?`)
    .all(workspaceId, limit) as { id: string; label: string; archetype: string | null; payload_json: string }[];
  return rows
    .map((r): MatrixProfile | null => {
      const payload = safeRowParse(r.payload_json, "listMatrixProfiles", r.id);
      return payload === null ? null : { id: r.id, label: r.label, archetype: r.archetype, payload };
    })
    .filter((p): p is MatrixProfile => p !== null);
}

/** Distinct positions we are actively hiring for = jobs that appear in the pipeline. */
export function listOpenPositions(workspaceId: string = DEFAULT_WORKSPACE_ID): { id: string; title: string; roleFamily: string | null }[] {
  const db = ensureDb();
  // DISTINCT on the (job_id, title, role_family) tuple is NOT distinct by position:
  // one job_id recorded with two titles/families (a title edited between pipeline
  // adds) surfaces the SAME id twice → duplicate matrix columns and duplicate React
  // keys downstream. Collapse on the stable job_id here, the single source of truth.
  // Order so the most-recently recorded row comes first (created_at desc — NULLs sort
  // last in SQLite — with id desc as a deterministic tiebreak) and keep the first per
  // id, so an edited title wins deterministically rather than picking an arbitrary row.
  const rows = db
    .prepare(
      `SELECT job_id AS id, job_title AS title, role_family AS roleFamily
       FROM pipeline_entries
       WHERE job_id IS NOT NULL AND workspace_id = ?
       ORDER BY created_at DESC, id DESC`
    )
    .all(workspaceId) as { id: string; title: string; roleFamily: string | null }[];
  const byId = new Map<string, { id: string; title: string; roleFamily: string | null }>();
  for (const r of rows) if (!byId.has(r.id)) byId.set(r.id, r);
  // Columns are presented alphabetically by title, preserving the prior ORDER BY job_title.
  return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/** candidateId|jobId -> {stage,status} for overlaying pipeline placement onto the matrix. */
export function pipelinePlacements(workspaceId: string = DEFAULT_WORKSPACE_ID): Record<string, { stage: string; status: string }> {
  const db = ensureDb();
  const rows = db
    .prepare(`SELECT candidate_id, job_id, stage, status FROM pipeline_entries WHERE candidate_id IS NOT NULL AND job_id IS NOT NULL AND workspace_id = ?`)
    .all(workspaceId) as { candidate_id: string; job_id: string; stage: string; status: string }[];
  const map: Record<string, { stage: string; status: string }> = {};
  for (const r of rows) map[`${r.candidate_id}|${r.job_id}`] = { stage: r.stage, status: r.status };
  return map;
}
