import { ensureDb } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";
import { randomId } from "../random-id";
import { freezeRubric, hashCriteria, rubricWouldChange, type FrozenRubric, type RubricCriterion } from "../role-rubric";
import type { RoleBrief } from "../rolespec";

// ADR-0009 — persistence for the role's frozen rubric. Append-only and
// versioned: see the role_rubrics comment in core.ts for why a re-freeze mints
// a new row rather than upserting the old one.
//
// Tenant scope: role_rubrics is OPERATOR-INTERNAL with no public token, so the
// stricter rule applies — every query here filters or stamps workspace_id,
// point reads included (the same rule role_intakes carries, pinned by a source
// guard test). A leaked job id must not resolve a rubric across tenants.

export type StoredRubric = FrozenRubric & {
  jobId: string;
  workspaceId: string;
  /** What caused this freeze — 'intake_promote' for the first freeze off a
   *  promoted brief, 'brief_edit' for a re-freeze after the JD changed. */
  source: string;
  frozenAt: string;
};

type RubricRow = {
  workspace_id: string;
  job_id: string;
  version: number;
  criteria_json: string;
  criteria_hash: string;
  source: string;
  frozen_at: string;
};

/** Revive a stored rubric. The criteria are re-hashed on READ and compared with
 *  the stored hash: a row whose JSON was edited underneath the hash is a rubric
 *  claiming to be a standard it is not, and a decision about a person must not
 *  be attributed to it. Such a row is refused rather than silently trusted. */
function rowToRubric(r: RubricRow): StoredRubric {
  let criteria: RubricCriterion[];
  try {
    const parsed: unknown = JSON.parse(r.criteria_json);
    criteria = Array.isArray(parsed) ? (parsed as RubricCriterion[]) : [];
  } catch {
    criteria = [];
  }
  if (hashCriteria(criteria) !== r.criteria_hash) {
    throw new Error(
      `role rubric ${r.job_id}@v${r.version} fails its own content hash — refusing to judge candidates against a tampered standard`
    );
  }
  return {
    jobId: r.job_id,
    workspaceId: r.workspace_id,
    version: r.version,
    criteriaHash: r.criteria_hash,
    criteria,
    source: r.source,
    frozenAt: r.frozen_at,
  };
}

/** The role's ACTIVE rubric (highest version), or null when the role has never
 *  frozen one — which is a real state, not an error: a job ingested before this
 *  work, or one promoted from a brief that stated no graded requirements. */
export function getActiveRubric(jobId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): StoredRubric | null {
  const db = ensureDb();
  const row = db
    .prepare(
      `SELECT workspace_id, job_id, version, criteria_json, criteria_hash, source, frozen_at
         FROM role_rubrics WHERE workspace_id = ? AND job_id = ? ORDER BY version DESC LIMIT 1`
    )
    .get(workspaceId, jobId) as RubricRow | undefined;
  return row ? rowToRubric(row) : null;
}

/** One specific version — how an evaluation stamped with `rubric_version` is
 *  read back against the criteria it was ACTUALLY produced under. */
export function getRubricVersion(
  jobId: string,
  version: number,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): StoredRubric | null {
  const db = ensureDb();
  const row = db
    .prepare(
      `SELECT workspace_id, job_id, version, criteria_json, criteria_hash, source, frozen_at
         FROM role_rubrics WHERE workspace_id = ? AND job_id = ? AND version = ?`
    )
    .get(workspaceId, jobId, version) as RubricRow | undefined;
  return row ? rowToRubric(row) : null;
}

export function listRubricVersions(jobId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): StoredRubric[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT workspace_id, job_id, version, criteria_json, criteria_hash, source, frozen_at
         FROM role_rubrics WHERE workspace_id = ? AND job_id = ? ORDER BY version ASC`
    )
    .all(workspaceId, jobId) as RubricRow[];
  return rows.map(rowToRubric);
}

export type FreezeOutcome = {
  rubric: StoredRubric;
  /** false when the brief judges candidates identically to the active rubric —
   *  the existing version is returned untouched. This is the common case on a
   *  JD re-promote and it is why a prose edit does not force a re-score. */
  minted: boolean;
};

/** Freeze `brief` as this role's rubric.
 *
 *  IDEMPOTENT ON CONTENT, not on calls: re-freezing an unchanged brief returns
 *  the existing version with `minted: false`, and only a brief that would judge
 *  candidates DIFFERENTLY mints the next version. That distinction is the whole
 *  point — it makes "the standard changed" a recorded event rather than an
 *  invisible consequence of editing a JD.
 *
 *  Throws EmptyRubricError (from role-rubric.ts) when the brief states no graded
 *  requirements: a rubric that can judge nobody must not reach the board, where
 *  it would report every candidate as fully met. */
export function freezeRoleRubric(
  jobId: string,
  brief: RoleBrief,
  options: { workspaceId?: string; source?: string } = {}
): FreezeOutcome {
  const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const active = getActiveRubric(jobId, workspaceId);
  if (active && !rubricWouldChange(active, brief)) return { rubric: active, minted: false };
  const version = active ? active.version + 1 : 1;
  const frozen = freezeRubric(brief, version);
  const source = options.source ?? (active ? "brief_edit" : "intake_promote");
  const frozenAt = new Date().toISOString();
  const db = ensureDb();
  // The unique (workspace, job, version) index is the real guard: two promotes
  // racing on one job both compute version N, and the loser must NOT overwrite
  // the winner's standard. INSERT OR IGNORE + re-read means the loser adopts
  // the rubric that actually landed rather than believing it wrote its own.
  db.prepare(
    `INSERT OR IGNORE INTO role_rubrics (id, workspace_id, job_id, version, criteria_json, criteria_hash, source, frozen_at)
     VALUES (@id, @workspace_id, @job_id, @version, @criteria_json, @criteria_hash, @source, @frozen_at)`
  ).run({
    id: randomId("rub"),
    workspace_id: workspaceId,
    job_id: jobId,
    version,
    criteria_json: JSON.stringify(frozen.criteria),
    criteria_hash: frozen.criteriaHash,
    source,
    frozen_at: frozenAt,
  });
  const stored = getRubricVersion(jobId, version, workspaceId);
  if (!stored) throw new Error(`role rubric ${jobId}@v${version} vanished immediately after insert`);
  return { rubric: stored, minted: stored.frozenAt === frozenAt && stored.criteriaHash === frozen.criteriaHash };
}
