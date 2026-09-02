import { randomId } from "../random-id";
import { ensureDb, safeRowParse } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";

// ---- App master repo scans (P2) ---------------------------------------------
//
// One row per "read this codebase into a RepoDossier" run (docs/concepts/app-master.md
// §3 step 2). The row — not the in-memory task — is the source of truth: the scan
// runs in the background, so the operator can navigate away and come back, and the
// intake (P3) reads the finished dossier by id.
//
// Tenancy: every query filters/stamps workspace_id, with NO by-id exemption. That
// is deliberate and it is not the usual "point read over a globally-unique PK"
// argument: a scan id is handed to the client that started it, and the row it
// resolves carries a filesystem path on the operator's own machine plus a full
// read of a private codebase. An unscoped by-id read would make the id a bearer
// token for another team's repo contents (repo-scans-tenancy.test.ts pins this).

export const REPO_SCAN_STATUSES = ["queued", "running", "complete", "failed"] as const;
export type RepoScanStatus = (typeof REPO_SCAN_STATUSES)[number];

export function isRepoScanStatus(value: unknown): value is RepoScanStatus {
  return typeof value === "string" && (REPO_SCAN_STATUSES as readonly string[]).includes(value);
}

/** Whole-dossier provenance. `null` until a run finishes — a queued scan has not
 *  yet earned the right to claim either path. */
export type RepoScanSource = "llm" | "heuristic" | null;

export type RepoScanRecord = {
  id: string;
  workspaceId: string;
  repoUrl: string | null;
  rootPath: string | null;
  status: RepoScanStatus;
  source: RepoScanSource;
  dossier: unknown;
  error: string | null;
  createdAt: string;
  updatedAt: string | null;
};

type RepoScanRow = {
  id: string;
  workspace_id: string;
  repo_url: string | null;
  root_path: string | null;
  status: string;
  source: string | null;
  dossier_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string | null;
};

function rowToScan(r: RepoScanRow): RepoScanRecord {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    repoUrl: r.repo_url,
    rootPath: r.root_path,
    // A row whose status was corrupted reads `failed`, never a silent `complete`:
    // the safe direction for an unreadable state is "this did not work".
    status: isRepoScanStatus(r.status) ? r.status : "failed",
    source: r.source === "llm" || r.source === "heuristic" ? r.source : null,
    dossier: safeRowParse<unknown>(r.dossier_json, "repoScan.dossier", r.id),
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Mint the row for a scan that is about to be queued. The caller (repo-scan.ts)
 *  has already validated and resolved `rootPath` against the allow-list — this
 *  store persists what it is given and never re-derives a path. */
export function createRepoScan(
  input: { id?: string; repoUrl?: string | null; rootPath?: string | null },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): RepoScanRecord {
  const db = ensureDb();
  const id = input.id ?? randomId("rscan");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO repo_scans (id, workspace_id, repo_url, root_path, status, created_at)
     VALUES (?, ?, ?, ?, 'queued', ?)`
  ).run(id, workspaceId, input.repoUrl ?? null, input.rootPath ?? null, now);
  return {
    id,
    workspaceId,
    repoUrl: input.repoUrl ?? null,
    rootPath: input.rootPath ?? null,
    status: "queued",
    source: null,
    dossier: null,
    error: null,
    createdAt: now,
    updatedAt: null,
  };
}

export function getRepoScanRecord(id: string, workspaceId: string = DEFAULT_WORKSPACE_ID): RepoScanRecord | null {
  const db = ensureDb();
  const row = db.prepare(`SELECT * FROM repo_scans WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as
    | RepoScanRow
    | undefined;
  return row ? rowToScan(row) : null;
}

export function listRepoScans(workspaceId: string = DEFAULT_WORKSPACE_ID, limit = 25): RepoScanRecord[] {
  const db = ensureDb();
  const rows = db
    .prepare(`SELECT * FROM repo_scans WHERE workspace_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(workspaceId, limit) as RepoScanRow[];
  return rows.map(rowToScan);
}

/** Move a scan into `running`. Returns whether the transition applied.
 *
 *  Every status writer below re-asserts the status it expects, because these are
 *  the write half of a read→compute→write whose compute is MINUTES long (a clone
 *  plus an in-repo agent session) and whose writers are not unique: the task
 *  runner can reap a run and the queue can hand the same scan out again. Without
 *  the predicate a late writer flipped a row that had already finished back to
 *  `running`, and the operator watched a finished scan restart. `queued|running`
 *  here so an idempotent retry of the SAME run is not an error. */
export function markRepoScanRunning(id: string, workspaceId: string = DEFAULT_WORKSPACE_ID): boolean {
  const db = ensureDb();
  const res = db
    .prepare(
      `UPDATE repo_scans SET status = 'running', updated_at = ?
        WHERE id = ? AND workspace_id = ? AND status IN ('queued', 'running')`
    )
    .run(new Date().toISOString(), id, workspaceId);
  return res.changes > 0;
}

/** Finish a scan with its dossier. `source` is the provenance the Python envelope
 *  reported — stored as given, because "which path produced this" is the fact the
 *  intake panel discloses to the operator.
 *
 *  Only a `running` scan can complete, and `null` means the transition was SKIPPED
 *  (already terminal, or gone, or another tenant's) — never "the row vanished".
 *  The caller logs a skipped transition; it does not retry and it does not throw. */
export function completeRepoScan(
  id: string,
  input: { dossier: unknown; source: Exclude<RepoScanSource, null> },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): RepoScanRecord | null {
  const db = ensureDb();
  const res = db
    .prepare(
      `UPDATE repo_scans
          SET status = 'complete', source = ?, dossier_json = ?, error = NULL, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND status = 'running'`
    )
    .run(input.source, JSON.stringify(input.dossier ?? null), new Date().toISOString(), id, workspaceId);
  return res.changes > 0 ? getRepoScanRecord(id, workspaceId) : null;
}

/** Fail a scan with a reason. A failed scan keeps whatever dossier a previous run
 *  wrote (there is none in practice — a scan is one-shot) and NEVER claims a
 *  source: an errored run did not produce a dossier by either path.
 *
 *  Only a `running` scan can fail — a queued one has no runner to speak for it, so
 *  cancelling it before it starts goes through `cancelQueuedRepoScan`. `null` means
 *  the transition was skipped. */
export function failRepoScan(
  id: string,
  error: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): RepoScanRecord | null {
  const db = ensureDb();
  const res = db
    .prepare(
      `UPDATE repo_scans SET status = 'failed', error = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND status = 'running'`
    )
    .run(error.slice(0, 2000), new Date().toISOString(), id, workspaceId);
  return res.changes > 0 ? getRepoScanRecord(id, workspaceId) : null;
}
/** Fail a scan that was cancelled before the runner ever picked it up. Guarded on
 *  `queued` precisely so it cannot race the runner: once a run is live, the runner's
 *  abort signal is what ends it and `failRepoScan` records the reason. */
export function cancelQueuedRepoScan(
  id: string,
  error: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): RepoScanRecord | null {
  const db = ensureDb();
  const res = db
    .prepare(
      `UPDATE repo_scans SET status = 'failed', error = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND status = 'queued'`
    )
    .run(error.slice(0, 2000), new Date().toISOString(), id, workspaceId);
  return res.changes > 0 ? getRepoScanRecord(id, workspaceId) : null;
}
