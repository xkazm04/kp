import type { VoiceTurn } from "../voice/types";
import type { RoleBrief } from "../rolespec";
import type { AppMasterSpec, RepoDossier } from "../schemas.generated";
// The VALUE, not just the type: schemas.generated.ts is the one declaration of these
// shapes (generated from the Python models, kept fresh by schemas:check), and importing
// only its types is how a Python-side rename stays invisible until a page renders
// `undefined`. See readRowColumn in ./core.
import { repoDossierSchema } from "../schemas.generated.ts";
import { randomId } from "../random-id";
import { ensureDb, safeRowParse } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";
import { capTranscript } from "../intake-transcript";

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

export { MAX_STORED_TURNS, COMPACTED_TURN_PREFIX, compactedTurnCount, capTranscript } from "../intake-transcript";

// The transcript cap + its compaction marker live in the React-free, DB-free
// `intake-transcript` module: the CHAT renders the marker, and a client
// component may not import this file (it pulls better-sqlite3 in with it).
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
  const dossier = safeRowParse<RepoDossier>(row.dossier_json, "roleIntake.dossier", row.id, repoDossierSchema);
  // NOT validated against appMasterSpecSchema: this column stores an AppMasterCompose
  // ({ spec, fit, composedAt }), a wrapper AROUND the generated spec rather than the
  // spec itself, so that schema would reject every row. The wrapper has no generated
  // declaration of its own — the honest state is unvalidated, not falsely validated.
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
//
// `expectedUpdatedAt` is what a caller that spent MINUTES in a spawn between its
// read and this write must pass (`/message`, `/voice-turn`): `.immediate()` alone
// buys nothing there, because the write lock is taken long after the read it is
// meant to protect, and the write replaces transcript AND brief wholesale — so a
// human brief edit, or the other plane's turn, landing during the spawn was
// silently reverted by whatever the spawn eventually returned. With it, the write
// re-asserts the version it was computed from and answers `moved` instead
// (intake-dialog-cas.test.ts). Omit it and the write keeps its unconditional
// shape, for the opener — which writes into a row it created microseconds ago.
export function updateIntakeDialog(
  id: string,
  patch: {
    transcript: VoiceTurn[];
    brief: RoleBrief | null;
    shape?: IntakeShape;
    title?: string;
    status?: IntakeStatus;
    expectedUpdatedAt?: string | null;
  },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): IntakeCasResult {
  const params = [
    // Bounded at the write, so a long session cannot grow the row without limit.
    JSON.stringify(capTranscript(patch.transcript)),
    patch.brief ? JSON.stringify(patch.brief) : null,
    patch.shape ?? null,
    patch.title?.trim() ? patch.title.trim().slice(0, 200) : null,
    patch.status ?? null,
    new Date().toISOString(),
    id,
    workspaceId,
  ];
  const set = `SET transcript_json = ?, brief_json = ?, shape = COALESCE(?, shape),
           title = COALESCE(?, title), status = COALESCE(?, status), updated_at = ?`;
  if (patch.expectedUpdatedAt !== undefined) {
    return casUpdate(
      `UPDATE role_intakes ${set}
       WHERE id = ? AND workspace_id = ? AND status != 'promoted' AND updated_at IS ?`,
      [...params, patch.expectedUpdatedAt],
      id,
      workspaceId
    );
  }
  const d = db();
  const run = d.transaction((): IntakeCasResult => {
    const existing = d
      .prepare(`SELECT id FROM role_intakes WHERE id = ? AND workspace_id = ?`)
      .get(id, workspaceId) as { id: string } | undefined;
    if (!existing) return "missing";
    d.prepare(`UPDATE role_intakes ${set} WHERE id = ? AND workspace_id = ?`).run(...(params as never[]));
    return "ok";
  });
  return run.immediate();
}

// The outcome of an App-master write that carries a row version with it.
// `moved` is NOT an error: it is the ordinary result of a requestor answering a
// question while a minutes-long Python spawn was still running, and the caller's
// job is to recompute rather than to clobber.
export type IntakeCasResult = "ok" | "moved" | "missing";

// COMPARE-AND-SWAP over `updated_at`, the row version every intake writer already
// stamps. Both App-master writes are read→compute→write across a spawn that can
// take MINUTES (runIntakeAppMasterSync), so `.immediate()` alone buys nothing —
// the write lock is taken long after the read it is meant to protect. The version
// read BEFORE the spawn is therefore re-asserted in the UPDATE's WHERE, and a
// `changes === 0` is disambiguated into `moved` vs `missing` inside the same
// transaction. `IS` rather than `=` because a freshly created intake has
// `updated_at NULL`, and `NULL = NULL` is not true in SQL.
//
// Granularity caveat: `updated_at` is an ISO string with millisecond resolution,
// so two writes inside the same millisecond are indistinguishable. The window
// this guards is a Python spawn, not a millisecond, so that is a theoretical hole
// rather than the one that was losing stated values.
function casUpdate(sql: string, params: unknown[], id: string, workspaceId: string): IntakeCasResult {
  const d = db();
  const run = d.transaction((): IntakeCasResult => {
    const res = d.prepare(sql).run(...(params as never[]));
    if (res.changes > 0) return "ok";
    const still = d
      .prepare(`SELECT id FROM role_intakes WHERE id = ? AND workspace_id = ? AND status != 'promoted'`)
      .get(id, workspaceId) as { id: string } | undefined;
    // The row is writable but the version moved under us — vs. gone/promoted,
    // which is a 404/409-frozen, not a retry.
    return still ? "moved" : "missing";
  });
  return run.immediate();
}

// A completed repo scan landed (App master): store the dossier verbatim and the
// brief it was merged into, and stamp the shape. IMMEDIATE for the same reason
// updateIntakeDialog is — a dossier landing while an exchange is in flight is a
// read→compute→write race over the same brief — PLUS the `expectedUpdatedAt`
// precondition, because the merge this brief came from was computed before a
// minutes-long spawn (see casUpdate). Frozen on a promoted session: the JD
// exists, its grounding record must not shift under it.
export function updateIntakeDossier(
  id: string,
  patch: { scanId: string; dossier: RepoDossier; brief: RoleBrief; expectedUpdatedAt: string | null },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): IntakeCasResult {
  return casUpdate(
    `UPDATE role_intakes
     SET dossier_json = ?, brief_json = ?, scan_id = ?, shape = 'app_master', updated_at = ?
     WHERE id = ? AND workspace_id = ? AND status != 'promoted' AND updated_at IS ?`,
    [
      JSON.stringify(patch.dossier),
      JSON.stringify(patch.brief),
      patch.scanId.slice(0, 120),
      new Date().toISOString(),
      id,
      workspaceId,
      patch.expectedUpdatedAt,
    ],
    id,
    workspaceId
  );
}

// The composed AppMasterSpec + its population-fit verdict. Re-composing
// REPLACES the record: a spec is a snapshot of the brief at compose time, and
// keeping a stale one beside a newer brief is the drift the doc-sync rule exists
// to prevent, one layer down.
//
// `cas` is what the compose ROUTE passes: the merged brief the spawn produced
// (persisted in the SAME write as the spec — the route used to hand that brief
// to the client and store only the spec, so the client adopted a brief that
// reverted on the next reload) plus the row version it was computed from. Omit
// it and the write keeps the old unconditional shape, for callers that hold no
// pre-spawn read.
export function updateIntakeAppMaster(
  id: string,
  compose: AppMasterCompose,
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  cas?: { brief: RoleBrief; expectedUpdatedAt: string | null }
): IntakeCasResult {
  if (!cas) {
    const res = db()
      .prepare(
        `UPDATE role_intakes SET app_master_spec_json = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ? AND status != 'promoted'`
      )
      .run(JSON.stringify(compose), new Date().toISOString(), id, workspaceId);
    return res.changes > 0 ? "ok" : "missing";
  }
  return casUpdate(
    `UPDATE role_intakes SET app_master_spec_json = ?, brief_json = ?, updated_at = ?
     WHERE id = ? AND workspace_id = ? AND status != 'promoted' AND updated_at IS ?`,
    [
      JSON.stringify(compose),
      JSON.stringify(cas.brief),
      new Date().toISOString(),
      id,
      workspaceId,
      cas.expectedUpdatedAt,
    ],
    id,
    workspaceId
  );
}

// The periodic voice EXTRACTION SWEEP's write (/voice-complete).
//
// The defect this shape exists for: the sweep read the transcript, spent SECONDS
// in a batch extraction, then wrote `[...preReadTranscript, ...itsOwnTurns]` —
// so a /voice-turn pair that landed during that window was erased, and the
// requestor's spoken words existed nowhere. The client fires both threads from
// the same `finally` block, so this is the ordinary case, not a rare one.
//
// The fix is structural rather than a compare-and-swap refusal: the sweep never
// carries a transcript in, only its OWN turns (the hang-up recovery payload),
// and the CURRENT stored transcript is re-read INSIDE the write transaction and
// appended to. There is therefore no window in which a concurrent turn can be
// lost, and — unlike the App-master writes, whose refusal protects a STATED
// value — a refusal here would throw away the recovery turns the payload is
// carrying, which is the very loss being fixed.
//
// `expectedUpdatedAt` is still passed and still reported (`moved`), because the
// caller and its tests need to know a turn landed mid-sweep; the brief is
// written anyway on `moved` and that is deliberate: the fast voice thread's LLM
// path leaves the stored brief untouched (extraction is THIS thread's job), and
// on the deterministic path this sweep declines to extract at all (`brief: null`
// below) — so the sweep's brief is never staler than the one it replaces. The
// transcript, which is the server truth a later sweep can re-extract from, is
// preserved either way.
//
// `brief: null` means "leave the stored brief alone" — the honest keyless
// outcome (extracted: false), not an empty brief.
export function updateIntakeVoiceSweep(
  id: string,
  patch: {
    turns: VoiceTurn[];
    brief: RoleBrief | null;
    shape?: IntakeShape;
    title?: string;
    expectedUpdatedAt: string | null;
  },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): { result: IntakeCasResult; transcript: VoiceTurn[] } {
  const d = db();
  const run = d.transaction((): { result: IntakeCasResult; transcript: VoiceTurn[] } => {
    const row = d
      .prepare(`SELECT * FROM role_intakes WHERE id = ? AND workspace_id = ? AND status != 'promoted'`)
      .get(id, workspaceId) as IntakeRow | undefined;
    if (!row) return { result: "missing", transcript: [] };
    const moved = (row.updated_at ?? null) !== (patch.expectedUpdatedAt ?? null);
    const transcript = capTranscript([...fromRow(row).transcript, ...patch.turns]);
    d.prepare(
      `UPDATE role_intakes
       SET transcript_json = ?, brief_json = COALESCE(?, brief_json), shape = COALESCE(?, shape),
           title = COALESCE(?, title), updated_at = ?
       WHERE id = ? AND workspace_id = ?`
    ).run(
      JSON.stringify(transcript),
      patch.brief ? JSON.stringify(patch.brief) : null,
      patch.shape ?? null,
      patch.title?.trim() ? patch.title.trim().slice(0, 200) : null,
      new Date().toISOString(),
      id,
      workspaceId
    );
    return { result: moved ? "moved" : "ok", transcript };
  });
  return run.immediate();
}

// A human edit of the brief (UAT drain §2.1) — brief_json only; the transcript
// is untouched (the dialog record stays honest). Refuses promoted sessions at
// the store level too (the JD exists; the brief behind it is frozen).
//
// `expectedUpdatedAt` is the version the route read to build the merge basis, and
// it is re-asserted in the WHERE so the edit lands on the row it was merged
// against or not at all. In THIS process that window is empty by construction
// (the route parses the body before the read, so nothing awaits between the read
// and this call) — what it actually guards is a second writer on the same SQLite
// file, and it makes every intake write in this module report the same
// ok/moved/missing vocabulary. The window it does NOT close is a stale TAB: the
// client does not carry a row version, so an edit typed against a session loaded
// ten minutes ago still merges against whatever is stored now (feature doc,
// Known gaps).
export function updateIntakeBrief(
  id: string,
  brief: RoleBrief,
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  cas?: { expectedUpdatedAt: string | null }
): IntakeCasResult {
  const params = [
    JSON.stringify(brief),
    typeof brief.title === "string" ? brief.title.trim().slice(0, 200) : "",
    new Date().toISOString(),
    id,
    workspaceId,
  ];
  const set = `SET brief_json = ?, title = COALESCE(NULLIF(?, ''), title), updated_at = ?`;
  if (!cas) {
    const res = db()
      .prepare(`UPDATE role_intakes ${set} WHERE id = ? AND workspace_id = ? AND status != 'promoted'`)
      .run(...(params as never[]));
    return res.changes > 0 ? "ok" : "missing";
  }
  return casUpdate(
    `UPDATE role_intakes ${set}
     WHERE id = ? AND workspace_id = ? AND status != 'promoted' AND updated_at IS ?`,
    [...params, cas.expectedUpdatedAt],
    id,
    workspaceId
  );
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
    const transcript = capTranscript([
      ...intake.transcript,
      { role: "system" as const, text: systemNote, at: new Date().toISOString() },
    ]);
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
