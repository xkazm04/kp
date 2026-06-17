import { ensureDb, insertWithUniqueSlug, safeRowParse } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";
import { maskCandidateName, scrubPiiFromPayload } from "../consent";

// ---- Candidate profiles (v2 archetype-aware intake) -----------------------

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

// Tenant scope (P2): `workspaceId` defaults to the single workspace (behavior-
// preserving; existing/candidate/task callers stay correct). INSERT stamps it;
// SELECT/UPDATE/DELETE filter by it.
export function saveProfile(input: SaveProfileInput, workspaceId: string = DEFAULT_WORKSPACE_ID): { id: string; createdAt: string } {
  const db = ensureDb();
  const createdAt = new Date().toISOString();
  const payloadJson = JSON.stringify(input.payload);
  const stmt = db.prepare(
    `INSERT INTO profiles (id, label, archetype, role_family, completeness, payload_json, created_at, workspace_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const id = insertWithUniqueSlug((s) =>
    stmt.run(s, input.label, input.archetype, input.roleFamily, input.completeness, payloadJson, createdAt, workspaceId)
  );
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
  const info = db
    .prepare(
      `UPDATE profiles SET label = ?, archetype = ?, role_family = ?, completeness = ?, payload_json = ?
       WHERE id = ? AND workspace_id = ?`
    )
    .run(input.label, input.archetype, input.roleFamily, input.completeness, JSON.stringify(input.payload), id, workspaceId);
  return Number(info.changes) > 0;
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
  return Number(info.changes) > 0;
}

// ---- Fit matrix (Phase 16) ------------------------------------------------

export type MatrixProfile = { id: string; label: string; archetype: string | null; payload: unknown };

export function listMatrixProfiles(limit = 200, workspaceId: string = DEFAULT_WORKSPACE_ID): MatrixProfile[] {
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
export function listOpenPositions(): { id: string; title: string; roleFamily: string | null }[] {
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
       WHERE job_id IS NOT NULL
       ORDER BY created_at DESC, id DESC`
    )
    .all() as { id: string; title: string; roleFamily: string | null }[];
  const byId = new Map<string, { id: string; title: string; roleFamily: string | null }>();
  for (const r of rows) if (!byId.has(r.id)) byId.set(r.id, r);
  // Columns are presented alphabetically by title, preserving the prior ORDER BY job_title.
  return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/** candidateId|jobId -> {stage,status} for overlaying pipeline placement onto the matrix. */
export function pipelinePlacements(): Record<string, { stage: string; status: string }> {
  const db = ensureDb();
  const rows = db
    .prepare(`SELECT candidate_id, job_id, stage, status FROM pipeline_entries WHERE candidate_id IS NOT NULL AND job_id IS NOT NULL`)
    .all() as { candidate_id: string; job_id: string; stage: string; status: string }[];
  const map: Record<string, { stage: string; status: string }> = {};
  for (const r of rows) map[`${r.candidate_id}|${r.job_id}`] = { stage: r.stage, status: r.status };
  return map;
}
