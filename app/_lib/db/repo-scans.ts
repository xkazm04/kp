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

/** Why a scan failed, as a CODE rather than as the thrown error's English message.
 *  `error` keeps that message for the server log; this is what the panel renders in
 *  the reader's language (the repo's "codes, never messages" rule, applied to a row
 *  instead of to a response body). Closed on purpose: a code with no catalog entry
 *  is a blank line on somebody's screen, so an unclassifiable failure is `unknown`
 *  and reads as the generic "the scan failed" copy.
 *
 *  The classifier that produces these lives with the throw sites it classifies
 *  (`classifyRepoScanError`, app/_lib/repo-scan-run.ts); the vocabulary lives here,
 *  beside the column that stores it. */
export const REPO_SCAN_ERROR_CODES = [
  "target_refused",
  "offline_refused",
  "git_missing",
  "clone_failed",
  "clone_timeout",
  "cancelled",
  "engine_failed",
  "unknown",
] as const;
export type RepoScanErrorCode = (typeof REPO_SCAN_ERROR_CODES)[number];

export function isRepoScanErrorCode(value: unknown): value is RepoScanErrorCode {
  return typeof value === "string" && (REPO_SCAN_ERROR_CODES as readonly string[]).includes(value);
}

/** MIRROR of `FALLBACK_CLASSES` in pipeline/jobfit/repo_scan.py — the class of thing
 *  that went wrong when a dossier completed but the in-repo agent fell back to the
 *  heuristic floor. Python is the single definition (it classifies where the
 *  exception was seen); this copy exists so the TS side can narrow the envelope
 *  before it reaches a row, and `repo-scan-run.test.ts` reads the Python tuple out
 *  of the source file and asserts set equality — never an eyeball comparison. */
export const REPO_SCAN_FALLBACK_CLASSES = [
  "agent_not_installed",
  "agent_timeout",
  "agent_unparseable",
  "agent_refused",
  "agent_output_too_large",
  "provider_error",
  "unknown",
] as const;
export type RepoScanFallbackClass = (typeof REPO_SCAN_FALLBACK_CLASSES)[number];

export function isRepoScanFallbackClass(value: unknown): value is RepoScanFallbackClass {
  return typeof value === "string" && (REPO_SCAN_FALLBACK_CLASSES as readonly string[]).includes(value);
}

export type RepoScanRecord = {
  id: string;
  workspaceId: string;
  repoUrl: string | null;
  rootPath: string | null;
  status: RepoScanStatus;
  source: RepoScanSource;
  dossier: unknown;
  error: string | null;
  /** The failure CLASS. `null` on every row that has not failed, and on rows written
   *  before the column existed — which reads as "no claim", never as a green one. */
  errorCode: RepoScanErrorCode | null;
  /** The raw `"<ExceptionType>: <message>"` line behind a fallback. Server-side
   *  only: it is English, unbounded, and can quote provider output, so the route
   *  projects `fallbackClass` and withholds this. */
  fallbackReason: string | null;
  /** That reason as the closed class the panel renders. `null` = the agent path did
   *  not fall back (or never ran — a keyless scan is the floor by design, not a
   *  fallback, and must not be reported as one). */
  fallbackClass: RepoScanFallbackClass | null;
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
  error_code: string | null;
  fallback_reason: string | null;
  fallback_class: string | null;
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
    // Both narrowed on the way OUT as well as on the way in: a row written by an
    // older build (or a hand-edited DB) must not put a string the catalogs have no
    // words for in front of a reader. An unrecognised value is no claim at all.
    errorCode: isRepoScanErrorCode(r.error_code) ? r.error_code : null,
    fallbackReason: r.fallback_reason,
    fallbackClass: isRepoScanFallbackClass(r.fallback_class) ? r.fallback_class : null,
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
    errorCode: null,
    fallbackReason: null,
    fallbackClass: null,
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
  input: {
    dossier: unknown;
    source: Exclude<RepoScanSource, null>;
    /** The raw diagnostic line, when the agent path fell back. Kept server-side. */
    fallbackReason?: string | null;
    /** …and its class, which is what the panel gets to render. */
    fallbackClass?: RepoScanFallbackClass | null;
  },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): RepoScanRecord | null {
  const db = ensureDb();
  const res = db
    .prepare(
      `UPDATE repo_scans
          SET status = 'complete', source = ?, dossier_json = ?, error = NULL, error_code = NULL,
              fallback_reason = ?, fallback_class = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND status = 'running'`
    )
    .run(
      input.source,
      JSON.stringify(input.dossier ?? null),
      // A complete WITHOUT a fallback clears both columns rather than leaving a
      // previous attempt's reason attached to a dossier it did not produce.
      input.fallbackReason ? input.fallbackReason.slice(0, 2000) : null,
      input.fallbackClass ?? null,
      new Date().toISOString(),
      id,
      workspaceId
    );
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
  code: RepoScanErrorCode = "unknown",
  workspaceId: string = DEFAULT_WORKSPACE_ID
): RepoScanRecord | null {
  const db = ensureDb();
  const res = db
    .prepare(
      `UPDATE repo_scans SET status = 'failed', error = ?, error_code = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND status = 'running'`
    )
    .run(error.slice(0, 2000), code, new Date().toISOString(), id, workspaceId);
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
      `UPDATE repo_scans SET status = 'failed', error = ?, error_code = 'cancelled', updated_at = ?
        WHERE id = ? AND workspace_id = ? AND status = 'queued'`
    )
    .run(error.slice(0, 2000), new Date().toISOString(), id, workspaceId);
  return res.changes > 0 ? getRepoScanRecord(id, workspaceId) : null;
}
