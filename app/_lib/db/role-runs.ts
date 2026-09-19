import { ensureDb, safeRowParse } from "./core.ts";
import { DEFAULT_WORKSPACE_ID } from "./workspaces.ts";
import { randomId } from "../random-id.ts";
import {
  assertStagePayloadPiiFree,
  isRoleRunStageKind,
  isRoleRunStageStatus,
  type RoleRunStageKind,
  type RoleRunStageStatus,
} from "../role-run-stages.ts";

// The role-run ledger (ADR-0009). A run is STATE, not a call stack: `role_runs` is one
// row per (job, cycle), and `role_run_stages` is the append-only log of typed stage
// artifacts that run produced. Resuming is re-reading the last artifact per branch — so
// a crash, a `next start` restart, the 20-minute pass ceiling, and a candidate who
// answers on Thursday are the same case, handled the same way.
//
// DDL OWNERSHIP: the two tables are created here, bound to the db INSTANCE, rather than
// in core.ts's shared initializer — the same pattern intakes.ts uses for its App-master
// columns and jd_revisions uses for its table. One owner per table keeps a concurrently
// landing increment out of the same diff in a 2,859-line file, and binding to the
// instance means a reset connection (every unit-test file) re-applies it.
//
// TENANCY: operator-internal with no public token, so EVERY query — point reads
// included — filters or stamps workspace_id (role-runs-tenancy.test.ts asserts this
// over the source, with no exemptions). A leaked run id must not resolve across tenants.

export const ROLE_RUN_STATUSES = ["running", "complete", "cancelled"] as const;
export type RoleRunStatus = (typeof ROLE_RUN_STATUSES)[number];

export function isRoleRunStatus(value: unknown): value is RoleRunStatus {
  return typeof value === "string" && (ROLE_RUN_STATUSES as readonly string[]).includes(value);
}

export type RoleRun = {
  id: string;
  workspaceId: string;
  jobId: string;
  cycle: string;
  status: RoleRunStatus;
  createdAt: string;
  updatedAt: string | null;
};

export type RoleRunStageArtifact = {
  id: string;
  runId: string;
  workspaceId: string;
  kind: RoleRunStageKind;
  /** The candidate branch this artifact belongs to (an entry id), or null for the
   *  run-wide stages S0/S1. See role-run-stages.RUN_WIDE_STAGES. */
  branchRef: string | null;
  seq: number;
  status: RoleRunStageStatus;
  payload: unknown;
  producedAt: string;
};

type RunRow = {
  id: string;
  workspace_id: string;
  job_id: string;
  cycle: string;
  status: string;
  created_at: string;
  updated_at: string | null;
};

type StageRow = {
  id: string;
  run_id: string;
  workspace_id: string;
  kind: string;
  branch_ref: string | null;
  seq: number;
  status: string;
  payload_json: string;
  produced_at: string;
};

function db() {
  const d = ensureDb();
  const marked = d as unknown as { __kpRoleRuns?: boolean };
  if (!marked.__kpRoleRuns) {
    d.exec(`
      -- One run per (job, cycle). The cycle is a free string rather than an integer so
      -- a caller can key a run on something meaningful ("2026-q4-backfill") without a
      -- schema change; the default "1" covers the single-run-per-job case.
      CREATE TABLE IF NOT EXISTS role_runs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'workspace',
        job_id TEXT NOT NULL,
        cycle TEXT NOT NULL DEFAULT '1',
        status TEXT NOT NULL DEFAULT 'running',
        created_at TEXT NOT NULL,
        updated_at TEXT
      );

      -- UNIQUE, not an index for speed: "re-running a role forks a second ledger for it"
      -- is the defect this prevents. getOrCreateRoleRun reads through it.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_role_runs_job_cycle
        ON role_runs (workspace_id, job_id, cycle);

      -- APPEND-ONLY. There is no UPDATE anywhere in this module for this table, and no
      -- DELETE: an artifact is the record of what the run did at a moment, and a run
      -- whose history can be edited cannot be the evidence behind a sealed decision.
      -- Correcting a stage means appending a newer artifact for the same (kind, branch)
      -- and letting seq order them.
      CREATE TABLE IF NOT EXISTS role_run_stages (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL DEFAULT 'workspace',
        kind TEXT NOT NULL,
        branch_ref TEXT,
        seq INTEGER NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        produced_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_role_run_stages_run
        ON role_run_stages (workspace_id, run_id, seq);
      CREATE INDEX IF NOT EXISTS idx_role_run_stages_branch
        ON role_run_stages (workspace_id, run_id, branch_ref, seq);
    `);
    marked.__kpRoleRuns = true;
  }
  return d;
}

function runFromRow(row: RunRow): RoleRun {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    jobId: row.job_id,
    cycle: row.cycle,
    // An unrecognized status reads as "running" rather than throwing: the run is the
    // thing the ledger is about, and refusing to read it because a future version wrote
    // a status this build does not know would lose the history too.
    status: isRoleRunStatus(row.status) ? row.status : "running",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function stageFromRow(row: StageRow): RoleRunStageArtifact | null {
  // A row whose kind or status this build does not recognize is dropped from the read
  // rather than coerced. Coercing would make an unknown stage masquerade as a known
  // one and let the engine advance a branch past a step it never actually ran.
  if (!isRoleRunStageKind(row.kind) || !isRoleRunStageStatus(row.status)) return null;
  return {
    id: row.id,
    runId: row.run_id,
    workspaceId: row.workspace_id,
    kind: row.kind,
    branchRef: row.branch_ref,
    seq: row.seq,
    status: row.status,
    payload: safeRowParse<unknown>(row.payload_json, `roleRunStage.${row.kind}`, row.id) ?? {},
    producedAt: row.produced_at,
  };
}

// --- RUNS --------------------------------------------------------------------

/** The run for (job, cycle), created if it does not exist. Idempotent by the unique
 *  index, so two concurrent callers converge on one ledger rather than forking two. */
export function getOrCreateRoleRun(
  input: { jobId: string; cycle?: string },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): { run: RoleRun; created: boolean } {
  const d = db();
  const cycle = (input.cycle ?? "1").trim() || "1";
  const jobId = input.jobId.trim();
  if (!jobId) throw new Error("getOrCreateRoleRun requires a jobId");

  const tx = d.transaction(() => {
    const existing = d
      .prepare(`SELECT * FROM role_runs WHERE workspace_id = ? AND job_id = ? AND cycle = ?`)
      .get(workspaceId, jobId, cycle) as RunRow | undefined;
    if (existing) return { run: runFromRow(existing), created: false };

    const id = randomId("rr");
    const now = new Date().toISOString();
    d.prepare(
      `INSERT INTO role_runs (id, workspace_id, job_id, cycle, status, created_at) VALUES (?, ?, ?, ?, 'running', ?)`
    ).run(id, workspaceId, jobId, cycle, now);
    const row = d.prepare(`SELECT * FROM role_runs WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as RunRow;
    return { run: runFromRow(row), created: true };
  });
  // IMMEDIATE: the read-then-insert above is exactly the shape that races. Taking the
  // write lock at BEGIN serializes two callers starting the same role's run in the same
  // millisecond, so the loser reads the winner's row instead of hitting the unique index.
  return tx.immediate();
}

export function getRoleRun(id: string, workspaceId: string = DEFAULT_WORKSPACE_ID): RoleRun | null {
  const row = db().prepare(`SELECT * FROM role_runs WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as
    | RunRow
    | undefined;
  return row ? runFromRow(row) : null;
}

export function listRoleRuns(
  opts: { jobId?: string; limit?: number } = {},
  workspaceId: string = DEFAULT_WORKSPACE_ID
): RoleRun[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = opts.jobId
    ? (db()
        .prepare(`SELECT * FROM role_runs WHERE workspace_id = ? AND job_id = ? ORDER BY created_at DESC LIMIT ?`)
        .all(workspaceId, opts.jobId, limit) as RunRow[])
    : (db()
        .prepare(`SELECT * FROM role_runs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?`)
        .all(workspaceId, limit) as RunRow[]);
  return rows.map(runFromRow);
}

/** Move the run's own status. The ARTIFACTS are append-only; the run row is a cursor
 *  over them and may be updated. Returns the run, or null when the id is not this
 *  tenant's. */
export function setRoleRunStatus(
  id: string,
  status: RoleRunStatus,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): RoleRun | null {
  db()
    .prepare(`UPDATE role_runs SET status = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`)
    .run(status, new Date().toISOString(), id, workspaceId);
  return getRoleRun(id, workspaceId);
}

// --- STAGE ARTIFACTS ---------------------------------------------------------

export type AppendStageInput = {
  runId: string;
  kind: RoleRunStageKind;
  branchRef?: string | null;
  status: RoleRunStageStatus;
  payload: unknown;
};

/** Append one artifact. Throws RoleRunPiiError when the payload breaks ADR-0009 §5, and
 *  throws when the run id is not this tenant's — both BEFORE the insert, so a rejected
 *  write leaves no partial row.
 *
 *  The PII check is here, at the one write door, rather than in each stage runner: a
 *  rule enforced per-caller is a rule that the next caller does not enforce. */
export function appendStageArtifact(
  input: AppendStageInput,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): RoleRunStageArtifact {
  assertStagePayloadPiiFree(input.payload);
  const d = db();
  const branchRef = input.branchRef?.trim() ? input.branchRef.trim() : null;
  const payloadJson = JSON.stringify(input.payload ?? {});

  const tx = d.transaction(() => {
    const run = d.prepare(`SELECT id FROM role_runs WHERE id = ? AND workspace_id = ?`).get(input.runId, workspaceId) as
      | { id: string }
      | undefined;
    if (!run) throw new Error(`role run ${input.runId} does not exist in this workspace`);

    // seq is per-RUN, not per-branch: it is the run's own clock, so "what happened in
    // what order across every branch" is a single ORDER BY rather than a merge of N
    // per-branch counters. Computed under the write lock, which is why the transaction
    // is immediate below.
    const maxSeq = d
      .prepare(`SELECT COALESCE(MAX(seq), 0) AS s FROM role_run_stages WHERE workspace_id = ? AND run_id = ?`)
      .get(workspaceId, input.runId) as { s: number };
    const id = randomId("rrs");
    const now = new Date().toISOString();
    d.prepare(
      `INSERT INTO role_run_stages (id, run_id, workspace_id, kind, branch_ref, seq, status, payload_json, produced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, input.runId, workspaceId, input.kind, branchRef, maxSeq.s + 1, input.status, payloadJson, now);
    d.prepare(`UPDATE role_runs SET updated_at = ? WHERE id = ? AND workspace_id = ?`).run(now, input.runId, workspaceId);

    const row = d
      .prepare(`SELECT * FROM role_run_stages WHERE id = ? AND workspace_id = ?`)
      .get(id, workspaceId) as StageRow;
    const artifact = stageFromRow(row);
    // Unreachable: we just wrote a kind and status this build declared. Throwing rather
    // than returning null keeps the return type honest for every caller.
    if (!artifact) throw new Error(`role_run_stage ${id} read back with an unrecognized kind/status`);
    return artifact;
  });
  return tx.immediate();
}

/** Every artifact of a run, oldest first. The run's whole history in one read — which
 *  is what "resume is a read" means. */
export function listStageArtifacts(
  runId: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): RoleRunStageArtifact[] {
  const rows = db()
    .prepare(`SELECT * FROM role_run_stages WHERE workspace_id = ? AND run_id = ? ORDER BY seq ASC`)
    .all(workspaceId, runId) as StageRow[];
  return rows.map(stageFromRow).filter((a): a is RoleRunStageArtifact => a !== null);
}

/** The newest artifact for (kind, branch), or null. `branchRef` null means the run-wide
 *  artifact, and is matched as IS NULL rather than `= NULL` — a distinction SQLite will
 *  silently answer "no rows" to if you get it wrong. */
export function latestStageArtifact(
  runId: string,
  kind: RoleRunStageKind,
  branchRef: string | null = null,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): RoleRunStageArtifact | null {
  const row = (
    branchRef === null
      ? db()
          .prepare(
            `SELECT * FROM role_run_stages WHERE workspace_id = ? AND run_id = ? AND kind = ? AND branch_ref IS NULL
             ORDER BY seq DESC LIMIT 1`
          )
          .get(workspaceId, runId, kind)
      : db()
          .prepare(
            `SELECT * FROM role_run_stages WHERE workspace_id = ? AND run_id = ? AND kind = ? AND branch_ref = ?
             ORDER BY seq DESC LIMIT 1`
          )
          .get(workspaceId, runId, kind, branchRef)
  ) as StageRow | undefined;
  return row ? stageFromRow(row) : null;
}

/** The newest artifact on a candidate branch regardless of kind — i.e. where that
 *  candidate actually stands. The single read the engine resumes a branch from. */
export function latestBranchArtifact(
  runId: string,
  branchRef: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): RoleRunStageArtifact | null {
  const row = db()
    .prepare(
      `SELECT * FROM role_run_stages WHERE workspace_id = ? AND run_id = ? AND branch_ref = ?
       ORDER BY seq DESC LIMIT 1`
    )
    .get(workspaceId, runId, branchRef) as StageRow | undefined;
  return row ? stageFromRow(row) : null;
}
