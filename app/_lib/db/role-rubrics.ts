import { z } from "zod";
import { rubricAxisSchema, type RubricAxis } from "../schemas.generated.ts";
import { randomId } from "../random-id";
import { ensureDb, readRowColumn } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";

// Role rubrics (ADR-0010 §2, docs/concepts/need-to-role-to-slate.md increment 2) —
// per job, an ordered list of weighted axes every candidate on the slate is scored
// against, a person and an AI agent alike.
//
// A rubric is VERSIONED and APPEND-ONLY. Re-deriving never edits a row: it mints the
// next version and leaves the previous one — and every score recorded against it —
// exactly as it was, so a candidate scored in week one stays comparable to one scored
// in week three, or the difference is visible as a version number. The one mutation a
// row ever takes is `frozen_at`, set once. That is not a convention this file keeps:
// the BEFORE UPDATE trigger below refuses any other change at the SQLite layer, so a
// future "just fix the weight" UPDATE fails loudly instead of silently re-scoring.
//
// Tenancy: operator-internal, no public token, so EVERY statement — point reads
// included — binds workspace_id (role-rubrics-tenancy.test.ts). The version UNIQUE is
// (workspace_id, job_id, version), not (job_id, version): a shared-corpus job carries
// workspace_id NULL in `jobs`, so two teams can each hold a rubric for the SAME job id,
// and each numbers its own versions from 1.
//
// The table lives HERE, not in core.ts's shared DDL — one owner per table (the note at
// the top of db/agents.ts). It is created on the shared ensureDb() connection, bound to
// the db INSTANCE so a reset connection (tests) re-applies it.

// Closed vocabulary, house pattern: literal array + derived union + runtime guard.
// Mirrored by the CHECK constraint on role_rubrics.source below.
//   brief  — derived from the role_intakes RoleBrief the job was promoted from
//   job    — derived from the job record itself (no intake behind it)
//   manual — authored by an operator
export const ROLE_RUBRIC_SOURCES = ["brief", "job", "manual"] as const;
export type RoleRubricSource = (typeof ROLE_RUBRIC_SOURCES)[number];

export function isRoleRubricSource(value: unknown): value is RoleRubricSource {
  return typeof value === "string" && (ROLE_RUBRIC_SOURCES as readonly string[]).includes(value);
}

export type RoleRubric = {
  id: string;
  workspaceId: string;
  jobId: string;
  /** The role_intakes row the axes were derived from, when there was one. */
  intakeId: string | null;
  /** 1-based, per (workspace, job). Monotonic; never reused. */
  version: number;
  /** The frozen axes. NULL ⇒ the stored column no longer parses as RubricAxis[] —
   *  recorded in getRowHealth(), and never something to score against. Never an
   *  empty list: the store refuses to mint one. */
  axes: RubricAxis[] | null;
  source: RoleRubricSource;
  createdAt: string;
  /** When the version was frozen; null while it is still a draft. Set once. */
  frozenAt: string | null;
};

type RubricRow = {
  id: string;
  workspace_id: string;
  job_id: string;
  intake_id: string | null;
  version: number;
  axes_json: string;
  source: string;
  created_at: string;
  frozen_at: string | null;
};

const axesSchema = z.array(rubricAxisSchema);

function rubricsDb() {
  const d = ensureDb();
  const marked = d as unknown as { __kpRoleRubrics?: boolean };
  if (!marked.__kpRoleRubrics) {
    d.exec(`
      CREATE TABLE IF NOT EXISTS role_rubrics (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        intake_id TEXT,
        version INTEGER NOT NULL CHECK (version >= 1),
        axes_json TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('brief', 'job', 'manual')),
        created_at TEXT NOT NULL,
        frozen_at TEXT,
        UNIQUE (workspace_id, job_id, version)
      );

      CREATE TRIGGER IF NOT EXISTS trg_role_rubrics_append_only
      BEFORE UPDATE ON role_rubrics
      WHEN NEW.id IS NOT OLD.id
        OR NEW.workspace_id IS NOT OLD.workspace_id
        OR NEW.job_id IS NOT OLD.job_id
        OR NEW.intake_id IS NOT OLD.intake_id
        OR NEW.version IS NOT OLD.version
        OR NEW.axes_json IS NOT OLD.axes_json
        OR NEW.source IS NOT OLD.source
        OR NEW.created_at IS NOT OLD.created_at
        OR OLD.frozen_at IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'role_rubrics is append-only: mint a new version; only frozen_at may be set, once');
      END;
    `);
    marked.__kpRoleRubrics = true;
  }
  return d;
}

function fromRow(row: RubricRow): RoleRubric {
  const axes = readRowColumn<RubricAxis[]>(row.axes_json, "roleRubric.axes", row.id, axesSchema);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    jobId: row.job_id,
    intakeId: row.intake_id,
    version: row.version,
    axes: axes.state === "ok" ? axes.value : null,
    // The CHECK constraint makes an off-vocabulary value unreachable through SQL;
    // "manual" is the claim that asserts least about where the axes came from.
    source: isRoleRubricSource(row.source) ? row.source : "manual",
    createdAt: row.created_at,
    frozenAt: row.frozen_at,
  };
}

export type MintRoleRubricInput = {
  jobId: string;
  intakeId?: string | null;
  axes: readonly unknown[];
  source: RoleRubricSource;
};

export type MintRoleRubricResult =
  | { ok: true; rubric: RoleRubric }
  | { ok: false; reason: "empty" | "invalid_axis" | "duplicate_axis_key" | "invalid_weight" | "invalid_input"; detail: string };

/** Mint the next rubric version for a job. Never an update: an unchanged brief
 *  re-derived still gets a new version, because "which rubric was this score made
 *  under" must be answerable from the version alone.
 *
 *  The axes are validated against the codegen'd RubricAxis schema BEFORE anything is
 *  written and stored as the parsed value (unknown keys dropped), so a row in this
 *  table is a rubric a scorer can read. Refusals are returned, not thrown — they are
 *  the caller's input, not a store accident. */
export function mintRoleRubric(input: MintRoleRubricInput, workspaceId: string = DEFAULT_WORKSPACE_ID): MintRoleRubricResult {
  const jobId = typeof input.jobId === "string" ? input.jobId.trim() : "";
  if (!jobId) return { ok: false, reason: "invalid_input", detail: "jobId is required" };
  if (!isRoleRubricSource(input.source)) {
    return { ok: false, reason: "invalid_input", detail: `source must be one of ${ROLE_RUBRIC_SOURCES.join(", ")}` };
  }
  if (!Array.isArray(input.axes) || input.axes.length === 0) {
    return { ok: false, reason: "empty", detail: "a rubric needs at least one axis" };
  }
  const parsed = axesSchema.safeParse(input.axes);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, reason: "invalid_axis", detail: `${issue?.path.join(".") || "(root)"}: ${issue?.message ?? "invalid"}` };
  }
  const axes = parsed.data;
  const seen = new Set<string>();
  for (const axis of axes) {
    // The key is what a recorded score names; two axes answering to one key would
    // make every basis row that cites it ambiguous.
    if (!axis.key.trim()) return { ok: false, reason: "invalid_axis", detail: "an axis has an empty key" };
    if (seen.has(axis.key)) return { ok: false, reason: "duplicate_axis_key", detail: axis.key };
    seen.add(axis.key);
    if (!Number.isFinite(axis.weight) || axis.weight < 0 || axis.weight > 1) {
      return { ok: false, reason: "invalid_weight", detail: `${axis.key}: weight must be within 0..1` };
    }
  }

  const d = rubricsDb();
  const intakeId = typeof input.intakeId === "string" && input.intakeId.trim() ? input.intakeId.trim() : null;
  const axesJson = JSON.stringify(axes);
  const id = randomId("rub");
  const now = new Date().toISOString();
  // read MAX(version) → write version + 1 is a read→compute→write: IMMEDIATE takes the
  // write lock at BEGIN, so a concurrent mint on another connection waits instead of
  // reading the same MAX and colliding on the UNIQUE (a DEFERRED read would abort with
  // SQLITE_BUSY_SNAPSHOT, which busy_timeout never retries).
  const mint = d.transaction((): number => {
    const top = d
      .prepare(`SELECT MAX(version) AS v FROM role_rubrics WHERE workspace_id = ? AND job_id = ?`)
      .get(workspaceId, jobId) as { v: number | null };
    const version = (top.v ?? 0) + 1;
    d.prepare(
      `INSERT INTO role_rubrics (id, workspace_id, job_id, intake_id, version, axes_json, source, created_at, frozen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    ).run(id, workspaceId, jobId, intakeId, version, axesJson, input.source, now);
    return version;
  });
  const version = mint.immediate();
  return {
    ok: true,
    rubric: { id, workspaceId, jobId, intakeId, version, axes, source: input.source, createdAt: now, frozenAt: null },
  };
}

/** One version of a job's rubric, or — with no version — the latest. Null when the
 *  job has no rubric in this workspace (a leaked job or rubric id never resolves
 *  another team's). */
export function getRoleRubric(jobId: string, workspaceId: string = DEFAULT_WORKSPACE_ID, version?: number): RoleRubric | null {
  const d = rubricsDb();
  const row = (
    version === undefined
      ? d
          .prepare(`SELECT * FROM role_rubrics WHERE workspace_id = ? AND job_id = ? ORDER BY version DESC LIMIT 1`)
          .get(workspaceId, jobId)
      : d
          .prepare(`SELECT * FROM role_rubrics WHERE workspace_id = ? AND job_id = ? AND version = ?`)
          .get(workspaceId, jobId, version)
  ) as RubricRow | undefined;
  return row ? fromRow(row) : null;
}

/** Every version of a job's rubric, oldest first. */
export function listRoleRubricVersions(jobId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): RoleRubric[] {
  const rows = rubricsDb()
    .prepare(`SELECT * FROM role_rubrics WHERE workspace_id = ? AND job_id = ? ORDER BY version ASC`)
    .all(workspaceId, jobId) as RubricRow[];
  return rows.map(fromRow);
}

/** Freeze one version. Idempotent and first-writer-wins: `frozen: true` only for the
 *  call that actually set `frozen_at`; a repeat (or a concurrent loser) gets
 *  `frozen: false` with the row as it stands, carrying the ORIGINAL freeze time.
 *  `rubric: null` ⇒ no such version in this workspace. The precondition lives in the
 *  UPDATE's WHERE, so there is no read→write gap to lock. */
export function freezeRoleRubric(
  jobId: string,
  version: number,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): { frozen: boolean; rubric: RoleRubric | null } {
  const res = rubricsDb()
    .prepare(
      `UPDATE role_rubrics SET frozen_at = ?
       WHERE workspace_id = ? AND job_id = ? AND version = ? AND frozen_at IS NULL`
    )
    .run(new Date().toISOString(), workspaceId, jobId, version);
  return { frozen: res.changes > 0, rubric: getRoleRubric(jobId, workspaceId, version) };
}
