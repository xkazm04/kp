import { createRepoScan, getRepoScanRecord, type RepoScanRecord } from "./db/repo-scans";
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

export type StartRepoScanResult = { scanId: string; taskId: string };

export function startRepoScan(
  input: { repoUrl?: string | null; rootPath?: string | null },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): StartRepoScanResult {
  const resolved = resolveScanTarget(input);
  if (!resolved.ok) throw new RepoScanRequestError(resolved.reason, resolved.status);

  // The id is minted here, not by the store, because it is also the dedupe key
  // (`repo_scan:<scanId>`) and the dossierId the Python side stamps on the result —
  // one identity across the row, the task and the artifact.
  const scanId = randomId("rscan");
  createRepoScan(
    { id: scanId, repoUrl: resolved.target.repoUrl, rootPath: resolved.target.rootPath },
    workspaceId
  );
  const task = startTask(
    "repo_scan",
    {
      scanId,
      repoUrl: resolved.target.repoUrl ?? undefined,
      rootPath: resolved.target.rootPath ?? undefined,
      workspaceId,
    },
    workspaceId
  );
  return { scanId, taskId: task.id };
}

export function getRepoScan(
  scanId: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): RepoScanRecord | null {
  return getRepoScanRecord(scanId, workspaceId);
}
