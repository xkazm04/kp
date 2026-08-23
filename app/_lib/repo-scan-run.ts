import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  completeRepoScan,
  failRepoScan,
  getRepoScanRecord,
  markRepoScanRunning,
  type RepoScanRecord,
} from "./db/repo-scans";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { buildLlmConfigEnv } from "./llm-config";
import { isOffline } from "./offline";
import { parsePythonJson, parseStderrError, PipelineError, spawnPython } from "./python-runner";
import { resolveScanTarget } from "./repo-scan-target";

// The `repo_scan` background task's body (App master P2). One verb: get a
// directory on disk that holds the repository, spawn
// `python -m pipeline.jobfit.repo_scan_cli --root <dir>`, parse the uniform
// provenance envelope, persist the dossier on the repo_scans row, and clean up
// anything this run created.
//
// Note what is NOT here: no `cwd` is passed to spawnPython. That is deliberate and
// it is documented on spawnPython itself — the child must start in the project root
// so `python -m pipeline.jobfit...` resolves. The repository under scan travels as
// `--root`, and the Python side is what hands that path to the Claude CLI as ITS
// cwd (repo_scan.bind_provider_to_repo → ClaudeCliProvider.with_repo_access).

/** Clone depth. Enough history for churn hot spots (repo_scan reads the last 200
 *  commits, and a shallower clone simply yields fewer — the walk reports its own
 *  denominator, so a short history is disclosed, not silently averaged). 50 keeps a
 *  scan of a large repo to seconds. */
export const CLONE_DEPTH = 50;

/** Wall-clock budget for `git clone`. A hung clone must not sit on one of the two
 *  task-runner slots until the global watchdog fires. */
export const CLONE_TIMEOUT_MS = 120_000;

/** Where URL scans are staged. Under the OS temp dir, one directory per scan id, so
 *  two concurrent scans can never collide and a leaked directory is attributable. */
export function scratchDirFor(scanId: string, tmpdir: string = os.tmpdir()): string {
  // The id is minted by randomId(); pin it to a safe charset anyway so a
  // hand-crafted id can never escape the scratch root through path.join.
  const safe = scanId.replace(/[^A-Za-z0-9._-]/g, "");
  return path.join(tmpdir, "kp-repo-scan", safe || "scan");
}

export type RepoScanResult = {
  record: RepoScanRecord;
  source: "llm" | "heuristic";
  fallbackReason: Record<string, string>;
};

type CliEnvelope = {
  result: Record<string, unknown>;
  source: string;
  perStepSources?: Record<string, string>;
  fallbackReason?: Record<string, string>;
};

/** Shape-check + normalize the CLI envelope (exported pure so the parse contract is
 *  unit-testable without spawning Python). Throws on a malformed envelope — the task
 *  runner surfaces that as a failed scan, never a half-persisted dossier.
 *
 *  `source` is narrowed to the dossier vocabulary here rather than trusted: the row
 *  discloses provenance to the operator, so an unrecognised value must read as the
 *  weaker claim (`heuristic`), never as "an agent read your repo". */
export function toRepoScanEnvelope(payload: unknown): { result: Record<string, unknown>; source: "llm" | "heuristic"; fallbackReason: Record<string, string> } {
  const p = payload as CliEnvelope | null;
  const r = p?.result;
  if (!r || typeof r !== "object" || Array.isArray(r)) {
    throw new Error("repo_scan_cli returned an unexpected envelope (missing result).");
  }
  if (typeof r.size !== "object" || !Array.isArray(r.contexts) || !Array.isArray(r.declaredGates)) {
    throw new Error("repo_scan_cli returned an unexpected envelope (not a RepoDossier).");
  }
  return {
    result: r,
    source: p?.source === "llm" ? "llm" : "heuristic",
    fallbackReason: p?.fallbackReason ?? {},
  };
}

/** Shallow-clone `repoUrl` into `dest`. Rejects with a plain message on failure —
 *  git's stderr can echo a URL with credentials in it, so only the exit status and a
 *  short, sanitized tail are surfaced. */
export async function shallowClone(repoUrl: string, dest: string, signal?: AbortSignal): Promise<void> {
  await mkdir(path.dirname(dest), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "git",
      ["clone", "--depth", String(CLONE_DEPTH), "--single-branch", "--no-tags", "--quiet", repoUrl, dest],
      {
        windowsHide: true,
        // Never let git open a credential prompt or an askpass dialog on a server:
        // a blocked prompt is a hang, and a *successful* one would attach the
        // operator's credentials to a URL a caller supplied.
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", GIT_CONFIG_NOSYSTEM: "1" },
      }
    );
    let stderr = "";
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (err) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
        reject(err);
      } else {
        resolve();
      }
    };
    const timer = setTimeout(
      () => finish(new Error(`Cloning the repository timed out after ${Math.round(CLONE_TIMEOUT_MS / 1000)}s.`)),
      CLONE_TIMEOUT_MS
    );
    const onAbort = () => finish(new Error("The scan was canceled."));
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf-8")).slice(-400);
    });
    child.once("error", () => finish(new Error("git is not available on this machine, so a URL scan cannot run.")));
    child.once("close", (code) => {
      if (code === 0) return finish();
      finish(new Error(`Could not clone the repository (git exited ${code ?? "?"}).${stderr.trim() ? ` ${stderr.trim().slice(-200)}` : ""}`));
    });
  });
}

export type RepoScanParams = {
  scanId?: unknown;
  repoUrl?: unknown;
  rootPath?: unknown;
};

export async function runRepoScan(
  params: RepoScanParams,
  signal?: AbortSignal,
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  lang = "en"
): Promise<RepoScanResult> {
  const scanId = typeof params.scanId === "string" ? params.scanId : "";
  if (!scanId) throw new Error("repo_scan needs a scanId.");
  const scan = getRepoScanRecord(scanId, workspaceId);
  if (!scan) throw new Error(`repo scan not found: ${scanId}`);

  markRepoScanRunning(scanId, workspaceId);
  let scratch: string | null = null;
  try {
    // Re-validate the target INSIDE the runner rather than trusting the row. The
    // row was written by a gated route, but the allow-list is process env: an
    // operator can narrow KP_APP_MASTER_REPO_ROOTS between a scan being queued and
    // it being run (a restart, a config change), and a queued scan must not outlive
    // the permission that admitted it.
    const resolved = resolveScanTarget({ repoUrl: scan.repoUrl, rootPath: scan.rootPath });
    if (!resolved.ok) throw new Error(resolved.reason);

    let root = resolved.target.rootPath;
    if (!root) {
      const url = resolved.target.repoUrl!;
      if (isOffline()) {
        throw new Error("KP_OFFLINE is set, so a remote repository cannot be cloned. Scan a local path instead.");
      }
      scratch = scratchDirFor(scanId);
      await rm(scratch, { recursive: true, force: true }); // a leftover from a reaped run
      await shallowClone(url, scratch, signal);
      root = scratch;
    }

    // KP_LLM_CONFIG so the repo_scan use case resolves BYOM keys / model routing —
    // llm-spawn-contract.test.ts pins this call site.
    const { result } = spawnPython(
      ["-m", "pipeline.jobfit.repo_scan_cli", "--root", root, "--lang", lang, "--dossier-id", scanId,
       ...(scan.repoUrl ? ["--repo-url", scan.repoUrl] : [])],
      { signal, env: buildLlmConfigEnv() }
    );
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) throw new PipelineError(parseStderrError(stderr, exitCode));
    const envelope = toRepoScanEnvelope(parsePythonJson<unknown>(stdout, stderr));

    const record = completeRepoScan(scanId, { dossier: envelope.result, source: envelope.source }, workspaceId);
    if (!record) throw new Error(`repo scan disappeared while running: ${scanId}`);
    return { record, source: envelope.source, fallbackReason: envelope.fallbackReason };
  } catch (error) {
    // The row is the thing the operator polls, so a failure has to land ON it — not
    // only on the task. `failed` with a reason beats a row stuck at `running`.
    const message = error instanceof Error ? error.message : "The repository scan failed.";
    failRepoScan(scanId, message, workspaceId);
    throw error;
  } finally {
    if (scratch) {
      // Best effort, by design: a clone we could not delete is a temp-dir problem,
      // not a reason to fail a scan that otherwise succeeded.
      await rm(scratch, { recursive: true, force: true }).catch(() => {});
    }
  }
}
