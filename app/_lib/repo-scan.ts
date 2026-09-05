import { claimRepoScan, getRepoScanRecord, type RepoScanRecord } from "./db/repo-scans";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { randomId } from "./random-id";
import { resolveScanTarget } from "./repo-scan-target";
import { startTask } from "./tasks";

// The App-master repo scan's front door (P2, docs/features/app-master/README.md).
// Two functions, and the shape of them is the contract P3's intake codes against:
//
//   startRepoScan({repoUrl?, rootPath?}, workspaceId) -> { scanId, taskId }
//   getRepoScan(scanId, workspaceId)                  -> RepoScanRecord | null
//
// Order matters here. The target is validated BEFORE a row is minted, so a refused
// scan leaves nothing behind — no half-row for the poller to find, no queued task
// spending a subprocess on a path the operator was never allowed to name. The row
// is then minted with the RESOLVED target (the real path, the normalized URL), so
// what the poller reads back is what will actually be read, not what was typed.

export class RepoScanRequestError extends Error {
  readonly status: number;
  constructor(reason: string, status = 400) {
    super(reason);
    this.name = "RepoScanRequestError";
    this.status = status;
  }
}

export type StartRepoScanResult = {
  scanId: string;
  /** `null` for a scan that is already COMPLETE: there is no run left to watch, and
   *  naming a task that finished before this request arrived is a green lie the
   *  poller then chases. */
  taskId: string | null;
  /** Whether this POST started a reading of the repository or was handed one that
   *  already covers it. The intake needs no new state for it — it polls the scan id
   *  either way — but a caller that wants to say "using the reading from a moment
   *  ago" has the fact rather than inferring it from a timestamp. */
  reused: boolean;
};

export function startRepoScan(
  input: { repoUrl?: string | null; rootPath?: string | null },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): StartRepoScanResult {
  const resolved = resolveScanTarget(input);
  if (!resolved.ok) throw new RepoScanRequestError(resolved.reason, resolved.status);

  // The id is minted here, not by the store, because it is the dossierId the Python
  // side stamps on the result — one identity across the row and the artifact. It is
  // no longer the dedupe key: keying by the id of a row minted per POST is a dedupe
  // that can never fire (task-dedupe.ts, `repo_scan`).
  const scanId = randomId("rscan");
  // Claim the TARGET, not the id. `claimRepoScan` takes the write lock and either
  // inserts this row or hands back the one already covering this repository — in
  // flight, or completed inside REPO_SCAN_REUSE_WINDOW_MS. Two scans of one target
  // are one clone plus one in-repo agent session; the second caller watches the
  // first caller's run.
  const { scan, reused } = claimRepoScan(
    { id: scanId, repoUrl: resolved.target.repoUrl, rootPath: resolved.target.rootPath },
    workspaceId
  );
  // A finished scan has nothing left to run. Starting a task on it would re-read a
  // repository whose dossier is already on the row, and `markRepoScanRunning` would
  // refuse the transition anyway — so the honest answer is the scan and no task.
  if (reused && scan.status === "complete") return { scanId: scan.id, taskId: null, reused: true };
  // For an in-flight reuse this returns the task ALREADY running (the dedupe key is
  // now tenant + target), so the caller gets something real to watch; and if that
  // task died with its process, this is how the row gets a runner again.
  const task = startTask(
    "repo_scan",
    {
      scanId: scan.id,
      repoUrl: resolved.target.repoUrl ?? undefined,
      rootPath: resolved.target.rootPath ?? undefined,
      workspaceId,
    },
    workspaceId
  );
  return { scanId: scan.id, taskId: task.id, reused };
}

export function getRepoScan(
  scanId: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): RepoScanRecord | null {
  return getRepoScanRecord(scanId, workspaceId);
}
