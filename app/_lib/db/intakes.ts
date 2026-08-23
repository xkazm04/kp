import type { VoiceTurn } from "../voice/types";
import type { RoleBrief } from "../rolespec";
import type { AppMasterSpec, RepoDossier } from "../schemas.generated";
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
// "app_master" (docs/features/app-master/README.md) is decided by an ACT, not
// by triage prose: the requestor pointed kp at a repository and a repo_scan
// was started. `scanId` is that pointer, stamped at creation so a reload can
// resume the scan; `dossier` is what the scan returned; `appMaster` is the
// composed spec + population-fit record.
export type IntakeShape = "power_unit" | "story" | "app_master" | null;

// What POST /api/intake/[id]/compose-app-master stores. The spec is the
// contract (appMasterSpecSchema); `fit` rides beside it because the verdict is
// judged over the SAME objectives at the SAME moment — separating them would
// let a reload show a verdict about a spec that has since changed.
export type AppMasterCompose = {
  spec: AppMasterSpec;
  fit: PopulationFit;
  composedAt: string;
};

// pipeline/jobfit/agentfit.py::assess_population_fit. "unassessed" is the
// disclosed unknown (the keyless path never returns anything else).
export type PopulationFit = {
  verdict: "human" | "agent" | "hybrid" | "unassessed";
  perObjective: { kpiKey: string; coverage: "automatable" | "assisted" | "human_only"; rationale: string }[];
  coverageRatio: number;
  source?: "llm" | "deterministic";
};

// Reference material attached to a session — a colleague's note or a saved JD
// the dialog grounds on. `text` is the full material (server-resolved for JD
// kind); size caps live at the route boundary.
export type IntakeAttachment = {
  kind: "note" | "jd";
  title: string;
  text: string;
  jdSlug?: string;
};

export type RoleIntake = {
  id: string;
  workspaceId: string;
  title: string;
  status: IntakeStatus;
  lang: string | null;
  transcript: VoiceTurn[];
  brief: RoleBrief | null;
  attachments: IntakeAttachment[];
  shape: IntakeShape;
  scanId: string | null;
  dossier: RepoDossier | null;
  appMaster: AppMasterCompose | null;
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
  attachment_json: string | null;
  shape: string | null;
  scan_id: string | null;
  dossier_json: string | null;
  app_master_spec_json: string | null;
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
  return value === "power_unit" || value === "story" || value === "app_master" ? value : null;
}

// The App-master columns are additive and NULL on every pre-existing row, so
// the DDL lives in this store (the skill-profiles/decision-record pattern)
// rather than in core.ts's shared migration list — one owner per table keeps a
// concurrent P2 landing `repo_scans` out of the same diff. Bound to the db
// INSTANCE so a reset connection (tests) re-applies it.
function db() {
  const d = ensureDb();
  const marked = d as unknown as { __kpIntakeAppMaster?: boolean };
  if (!marked.__kpIntakeAppMaster) {
    for (const col of [
      // The repo_scan this session was started from (P2's contract). Stamped at
      // CREATE, before any dossier exists, so a reload can resume a scan that
      // is still running instead of orphaning it.
      "scan_id TEXT",
      // The RepoDossier that scan returned (repoDossierSchema). NULL while the
      // scan runs, or when it failed — the dialog reads it every turn.
      "dossier_json TEXT",
      // The composed AppMasterCompose {spec, fit, composedAt}.
      "app_master_spec_json TEXT",
    ]) {
      try {
        d.exec(`ALTER TABLE role_intakes ADD COLUMN ${col}`);
      } catch {
        /* column already exists — idempotent (the benign path core.ts's migrateExec takes) */
      }
    }
    marked.__kpIntakeAppMaster = true;
  }
  return d;
}

function fromRow(row: IntakeRow): RoleIntake {
  const transcript = safeRowParse<VoiceTurn[]>(row.transcript_json, "roleIntake.transcript", row.id);
  const brief = safeRowParse<RoleBrief>(row.brief_json, "roleIntake.brief", row.id);
  const attachments = safeRowParse<IntakeAttachment[]>(row.attachment_json, "roleIntake.attachments", row.id);
  const dossier = safeRowParse<RepoDossier>(row.dossier_json, "roleIntake.dossier", row.id);
  const appMaster = safeRowParse<AppMasterCompose>(row.app_master_spec_json, "roleIntake.appMaster", row.id);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    status: coerceStatus(row.status),
    lang: row.lang,
    transcript: Array.isArray(transcript) ? transcript : [],
    brief: brief && typeof brief === "object" ? brief : null,
    attachments: Array.isArray(attachments) ? attachments : [],
    shape: coerceShape(row.shape),
    scanId: row.scan_id ?? null,
    dossier: dossier && typeof dossier === "object" ? dossier : null,
    appMaster: appMaster && typeof appMaster === "object" ? appMaster : null,
    jdSlug: row.jd_slug,
    jobId: row.job_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createIntake(
  // `scanId` present ⇒ this is an App master session: the shape is stamped at
  // CREATE (an act, not a triage) so a reload knows to resume the scan even
  // before a dossier exists.
  input: { title?: string; lang?: string | null; scanId?: string | null },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): RoleIntake {
  const d = db();
  const id = randomId("intake");
  const now = new Date().toISOString();
  const scanId = input.scanId?.trim() ? input.scanId.trim().slice(0, 120) : null;
  d.prepare(
    `INSERT INTO role_intakes (id, workspace_id, title, status, lang, transcript_json, brief_json, shape, scan_id, created_at)
     VALUES (?, ?, ?, 'open', ?, '[]', NULL, ?, ?, ?)`
  ).run(
    id,
    workspaceId,
    (input.title ?? "").trim().slice(0, 200),
    input.lang ?? null,
    scanId ? "app_master" : null,
    scanId,
    now
  );
  const row = d
    .prepare(`SELECT * FROM role_intakes WHERE id = ? AND workspace_id = ?`)
    .get(id, workspaceId) as IntakeRow;
  return fromRow(row);
}

export function getIntake(id: string, workspaceId: string = DEFAULT_WORKSPACE_ID): RoleIntake | null {
  const row = db()
    .prepare(`SELECT * FROM role_intakes WHERE id = ? AND workspace_id = ?`)
    .get(id, workspaceId) as IntakeRow | undefined;
  return row ? fromRow(row) : null;
}

export type IntakeSummary = Pick<
  RoleIntake,
  "id" | "title" | "status" | "shape" | "scanId" | "jdSlug" | "jobId" | "createdAt" | "updatedAt"
> & { turnCount: number };

export function listIntakes(workspaceId: string = DEFAULT_WORKSPACE_ID): IntakeSummary[] {
  const rows = db()
    .prepare(
      `SELECT id, title, status, shape, scan_id, jd_slug, job_id, transcript_json, created_at, updated_at
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
      scanId: row.scan_id ?? null,
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
  const d = db();
  const run = d.transaction(() => {
    const existing = d
      .prepare(`SELECT id FROM role_intakes WHERE id = ? AND workspace_id = ?`)
      .get(id, workspaceId) as { id: string } | undefined;
    if (!existing) return false;
    d.prepare(
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

// A completed repo scan landed (App master): store the dossier verbatim and the
// brief it was merged into, and stamp the shape. IMMEDIATE for the same reason
// updateIntakeDialog is — a dossier landing while an exchange is in flight is a
// read→compute→write race over the same brief. Frozen on a promoted session:
// the JD exists, its grounding record must not shift under it.
export function updateIntakeDossier(
  id: string,
  patch: { scanId: string; dossier: RepoDossier; brief: RoleBrief },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): boolean {
  const d = db();
  const run = d.transaction(() => {
    const res = d
      .prepare(
        `UPDATE role_intakes
         SET dossier_json = ?, brief_json = ?, scan_id = ?, shape = 'app_master', updated_at = ?
         WHERE id = ? AND workspace_id = ? AND status != 'promoted'`
      )
      .run(
        JSON.stringify(patch.dossier),
        JSON.stringify(patch.brief),
        patch.scanId.slice(0, 120),
        new Date().toISOString(),
        id,
        workspaceId
      );
    return res.changes > 0;
  });
  return run.immediate();
}

// The composed AppMasterSpec + its population-fit verdict. Re-composing
// REPLACES the record: a spec is a snapshot of the brief at compose time, and
// keeping a stale one beside a newer brief is the drift the doc-sync rule exists
// to prevent, one layer down.
export function updateIntakeAppMaster(
  id: string,
  compose: AppMasterCompose,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): boolean {
  const res = db()
    .prepare(
      `UPDATE role_intakes SET app_master_spec_json = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND status != 'promoted'`
    )
    .run(JSON.stringify(compose), new Date().toISOString(), id, workspaceId);
  return res.changes > 0;
}

// A human edit of the brief (UAT drain §2.1) — brief_json only; the transcript
// is untouched (the dialog record stays honest). Refuses promoted sessions at
// the store level too (the JD exists; the brief behind it is frozen).
export function updateIntakeBrief(
  id: string,
  brief: RoleBrief,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): boolean {
  const res = db()
    .prepare(
      `UPDATE role_intakes SET brief_json = ?, title = COALESCE(NULLIF(?, ''), title), updated_at = ?
       WHERE id = ? AND workspace_id = ? AND status != 'promoted'`
    )
    .run(
      JSON.stringify(brief),
      typeof brief.title === "string" ? brief.title.trim().slice(0, 200) : "",
      new Date().toISOString(),
      id,
      workspaceId
    );
  return res.changes > 0;
}

// Replace the session's attachment list (add/remove both route through the
// route's validated full-list write). Promoted sessions are frozen like the
// brief — the JD exists, its grounding record shouldn't shift under it.
export function updateIntakeAttachments(
  id: string,
  attachments: IntakeAttachment[],
  workspaceId: string = DEFAULT_WORKSPACE_ID
): boolean {
  const res = db()
    .prepare(
      `UPDATE role_intakes SET attachment_json = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND status != 'promoted'`
    )
    .run(JSON.stringify(attachments), new Date().toISOString(), id, workspaceId);
  return res.changes > 0;
}

// Re-open a completed (NOT promoted) session (UAT drain §2.1): status back to
// open + a system turn appended so the transcript honestly records the gap.
// IMMEDIATE read-modify-write like updateIntakeDialog.
export function reopenIntake(
  id: string,
  systemNote: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): RoleIntake | null {
  const d = db();
  const run = d.transaction(() => {
    const row = d
      .prepare(`SELECT * FROM role_intakes WHERE id = ? AND workspace_id = ? AND status = 'complete'`)
      .get(id, workspaceId) as IntakeRow | undefined;
    if (!row) return null;
    const intake = fromRow(row);
    const transcript = [...intake.transcript, { role: "system" as const, text: systemNote, at: new Date().toISOString() }];
    d.prepare(
      `UPDATE role_intakes SET status = 'open', transcript_json = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`
    ).run(JSON.stringify(transcript), new Date().toISOString(), id, workspaceId);
    return { ...intake, status: "open" as const, transcript };
  });
  return run.immediate();
}

// The promoted RoleBrief behind a job — the back-link consumers (interview
// grounding, decision audit) read. Latest promoted intake wins when a job was
// re-promoted. Workspace-scoped like every role_intakes query; callers derive
// the workspace from the job (getJobWorkspace) when outside a session scope.
export function promotedBriefForJob(jobId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): RoleBrief | null {
  const row = db()
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
  const res = db()
    .prepare(
      `UPDATE role_intakes SET status = 'promoted', jd_slug = ?, job_id = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`
    )
    .run(refs.jdSlug, refs.jobId, new Date().toISOString(), id, workspaceId);
  return res.changes > 0;
}
