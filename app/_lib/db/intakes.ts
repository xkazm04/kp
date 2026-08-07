import type { VoiceTurn } from "../voice/types";
import type { RoleBrief } from "../rolespec";
import { randomId } from "../random-id";
import { ensureDb, safeRowParse } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";

// Role-intake dialogs (docs/concepts/role-intake-dialog.md, Phase 1) — the
// stored conversation with a hiring requestor plus the evolving RoleBrief.
//
// Transcript reuses the cross-plane VoiceTurn contract (app/_lib/voice/types):
// role "interviewer" = the intake agent, role "candidate" = the REQUESTOR
// (team lead / HR). The name is candidate-side legacy; keeping the union means
// every transcript renderer/telemetry helper works on intake dialogs unchanged.
//
// Tenancy: operator-internal surface with no public token, so EVERY query —
// point reads included — filters workspace_id (intakes-tenancy.test.ts). An id
// never crosses tenants even if leaked.

export type IntakeStatus = "open" | "complete" | "promoted";

// Session shape detected by the dialog engine: "power_unit" = a known role
// slotting into an existing team (fast path, few questions); "story" = a
// complex/ambiguous need that warrants the exploratory register; null = not
// yet detected.
export type IntakeShape = "power_unit" | "story" | null;

export type RoleIntake = {
  id: string;
  workspaceId: string;
  title: string;
  status: IntakeStatus;
  lang: string | null;
  transcript: VoiceTurn[];
  brief: RoleBrief | null;
  shape: IntakeShape;
  jdSlug: string | null;
  jobId: string | null;
  createdAt: string;
  updatedAt: string | null;
};

type IntakeRow = {
  id: string;
  workspace_id: string;
  title: string;
  status: string;
  lang: string | null;
  transcript_json: string | null;
  brief_json: string | null;
  shape: string | null;
  jd_slug: string | null;
  job_id: string | null;
  created_at: string;
  updated_at: string | null;
};

const STATUSES: readonly IntakeStatus[] = ["open", "complete", "promoted"];

function coerceStatus(value: string): IntakeStatus {
  return (STATUSES as readonly string[]).includes(value) ? (value as IntakeStatus) : "open";
}

function coerceShape(value: string | null): IntakeShape {
  return value === "power_unit" || value === "story" ? value : null;
}

function fromRow(row: IntakeRow): RoleIntake {
  const transcript = safeRowParse<VoiceTurn[]>(row.transcript_json, "roleIntake.transcript", row.id);
  const brief = safeRowParse<RoleBrief>(row.brief_json, "roleIntake.brief", row.id);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    status: coerceStatus(row.status),
    lang: row.lang,
    transcript: Array.isArray(transcript) ? transcript : [],
    brief: brief && typeof brief === "object" ? brief : null,
    shape: coerceShape(row.shape),
    jdSlug: row.jd_slug,
    jobId: row.job_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createIntake(
  input: { title?: string; lang?: string | null },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): RoleIntake {
  const db = ensureDb();
  const id = randomId("intake");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO role_intakes (id, workspace_id, title, status, lang, transcript_json, brief_json, created_at)
     VALUES (?, ?, ?, 'open', ?, '[]', NULL, ?)`
  ).run(id, workspaceId, (input.title ?? "").trim().slice(0, 200), input.lang ?? null, now);
  const row = db
    .prepare(`SELECT * FROM role_intakes WHERE id = ? AND workspace_id = ?`)
    .get(id, workspaceId) as IntakeRow;
  return fromRow(row);
}

export function getIntake(id: string, workspaceId: string = DEFAULT_WORKSPACE_ID): RoleIntake | null {
  const row = ensureDb()
    .prepare(`SELECT * FROM role_intakes WHERE id = ? AND workspace_id = ?`)
    .get(id, workspaceId) as IntakeRow | undefined;
  return row ? fromRow(row) : null;
}

export type IntakeSummary = Pick<
  RoleIntake,
  "id" | "title" | "status" | "shape" | "jdSlug" | "jobId" | "createdAt" | "updatedAt"
> & { turnCount: number };

export function listIntakes(workspaceId: string = DEFAULT_WORKSPACE_ID): IntakeSummary[] {
  const rows = ensureDb()
    .prepare(
      `SELECT id, title, status, shape, jd_slug, job_id, transcript_json, created_at, updated_at
       FROM role_intakes WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 200`
    )
    .all(workspaceId) as IntakeRow[];
  return rows.map((row) => {
    const transcript = safeRowParse<VoiceTurn[]>(row.transcript_json, "roleIntake.transcript", row.id);
    return {
      id: row.id,
      title: row.title,
      status: coerceStatus(row.status),
      shape: coerceShape(row.shape),
      jdSlug: row.jd_slug,
      jobId: row.job_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      turnCount: Array.isArray(transcript) ? transcript.length : 0,
    };
  });
}

// One dialog exchange landed: persist the appended turns + the re-extracted
// brief (and the detected shape / evolving title) atomically. IMMEDIATE so the
// read→compute→write of two racing messages on the same intake serializes
// (the later write wins whole-row, never a spliced transcript).
export function updateIntakeDialog(
  id: string,
  patch: {
    transcript: VoiceTurn[];
    brief: RoleBrief | null;
    shape?: IntakeShape;
    title?: string;
    status?: IntakeStatus;
  },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): boolean {
  const db = ensureDb();
  const run = db.transaction(() => {
    const existing = db
      .prepare(`SELECT id FROM role_intakes WHERE id = ? AND workspace_id = ?`)
      .get(id, workspaceId) as { id: string } | undefined;
    if (!existing) return false;
    db.prepare(
      `UPDATE role_intakes
       SET transcript_json = ?, brief_json = ?, shape = COALESCE(?, shape),
           title = COALESCE(?, title), status = COALESCE(?, status), updated_at = ?
       WHERE id = ? AND workspace_id = ?`
    ).run(
      JSON.stringify(patch.transcript),
      patch.brief ? JSON.stringify(patch.brief) : null,
      patch.shape ?? null,
      patch.title?.trim() ? patch.title.trim().slice(0, 200) : null,
      patch.status ?? null,
      new Date().toISOString(),
      id,
      workspaceId
    );
    return true;
  });
  return run.immediate();
}

// The promoted RoleBrief behind a job — the back-link consumers (interview
// grounding, decision audit) read. Latest promoted intake wins when a job was
// re-promoted. Workspace-scoped like every role_intakes query; callers derive
// the workspace from the job (getJobWorkspace) when outside a session scope.
export function promotedBriefForJob(jobId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): RoleBrief | null {
  const row = ensureDb()
    .prepare(
      `SELECT id, brief_json FROM role_intakes
       WHERE job_id = ? AND workspace_id = ? AND status = 'promoted'
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(jobId, workspaceId) as Pick<IntakeRow, "id" | "brief_json"> | undefined;
  if (!row) return null;
  const brief = safeRowParse<RoleBrief>(row.brief_json, "roleIntake.brief", row.id);
  return brief && typeof brief === "object" ? brief : null;
}

// Promotion stamps the produced JD/job onto the intake and closes it. The
// jd_slug/job_id back-links are what let downstream surfaces walk a job back
// to the conversation that defined it.
export function markIntakePromoted(
  id: string,
  refs: { jdSlug: string; jobId: string | null },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): boolean {
  const res = ensureDb()
    .prepare(
      `UPDATE role_intakes SET status = 'promoted', jd_slug = ?, job_id = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`
    )
    .run(refs.jdSlug, refs.jobId, new Date().toISOString(), id, workspaceId);
  return res.changes > 0;
}
