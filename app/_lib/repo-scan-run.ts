import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  completeRepoScan,
  failRepoScan,
  getRepoScanRecord,
  isRepoScanFallbackClass,
  markRepoScanRunning,
  type RepoScanErrorCode,
  type RepoScanFallbackClass,
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

/** The phases this runner can actually OBSERVE, reported through `ctx.progress` so
 *  the task row says which one is live instead of showing four minutes of
 *  undifferentiated "running" (the same move analyze-run.ts made with
 *  ANALYZE_PHASE).
 *
 *  Note what is NOT here: a `model` phase. The in-repo agent session runs INSIDE the
 *  Python child, which speaks once, at the end — so from here "the walk is running"
 *  and "the model is thinking" are the same span, and splitting them would mean
 *  guessing at a boundary this process cannot see. A guessed phase is exactly the
 *  cosmetic timeline this direction is removing. Which path actually produced the
 *  dossier is disclosed afterwards, truthfully, by the row's `source`. */
export const REPO_SCAN_PHASE = {
  /** Shallow-cloning a URL target. Skipped entirely for a local path. */
  clone: "clone",
  /** The Python child is running: the heuristic walk, then the agent refinement. */
  walk: "walk",
  /** The envelope came back; the dossier is being written to the row. */
  saving: "saving",
} as const;
export type RepoScanPhase = (typeof REPO_SCAN_PHASE)[keyof typeof REPO_SCAN_PHASE];

const PHASE_TOTAL = 3;

/** A failure that already knows its own class. Thrown at the sites that KNOW what
 *  went wrong (git missing, the clone timed out, offline refused the clone), so the
 *  code on the row is a fact recorded where it was observed rather than a guess
 *  reconstructed later by matching English. */
export class RepoScanFailure extends Error {
  readonly code: RepoScanErrorCode;
  constructor(message: string, code: RepoScanErrorCode) {
    super(message);
    this.name = "RepoScanFailure";
    this.code = code;
  }
}

/** Whether an abort reason says "the wall-clock budget ran out" rather than "somebody
 *  pressed Cancel".
 *
 *  Matched on the WEB's own name, not on a kp constant: `AbortSignal.timeout()`
 *  aborts with `DOMException(..., "TimeoutError")` and the task watchdog now does
 *  the same, so any future timeout source is classified correctly without this
 *  module importing the task runner (which imports it back). A plain
 *  `controller.abort()` yields an `AbortError`, and every other reason — a string,
 *  an object, nothing — reads as a cancel, which is the safe direction: claiming a
 *  timeout the evidence does not support would send the operator to shrink a repo
 *  that was never the problem. */
export function isTimeoutAbort(reason: unknown): boolean {
  return typeof reason === "object" && reason !== null && (reason as { name?: unknown }).name === "TimeoutError";
}

/** The failure CLASS for the row. `unknown` is a real answer — it renders as the
 *  generic "the scan failed" line — and is far better than inventing a class the
 *  evidence does not support.
 *
 *  The abort check comes FIRST on purpose: an aborted run surfaces as whatever
 *  error the killed step happened to raise (a git exit code, a SIGKILLed child), and
 *  reporting that as an engine fault would blame the engine for the operator's own
 *  Cancel.
 *
 *  But an abort is not always the operator's. The task runner aborts the SAME
 *  controller when a run passes `TASK_MAX_RUNTIME_MS` (tasks.ts), and answering
 *  `cancelled` there told the operator they had stopped a scan they had in fact
 *  watched for fifteen minutes — so they re-ran it unchanged and waited another
 *  fifteen. The reason separates them, and `timeout` is the code that says
 *  "nothing you did; this repository is too big for one budget". */
export function classifyRepoScanError(error: unknown, signal?: AbortSignal): RepoScanErrorCode {
  if (signal?.aborted) return isTimeoutAbort(signal.reason) ? "timeout" : "cancelled";
  if (error instanceof RepoScanFailure) return error.code;
  if (error instanceof PipelineError) return "engine_failed";
  return "unknown";
}

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

/** MIRROR of `FENCE_STATES` in pipeline/jobfit/repo_scan.py — how much the scan can
 *  honestly claim about the fence that keeps the in-repo agent out of `.env` and its
 *  friends. Those deny rules are pinned to ONE verified Claude CLI version in a code
 *  comment; nothing used to notice when the installed CLI had moved past it, so an
 *  upstream change to the rule grammar would silently widen what the agent may read.
 *  It cannot be re-verified without a live session, so the scan discloses instead.
 *
 *  Python is the single definition (it knows which CLI actually ran); this copy is
 *  the narrowing, and `repo-scan-run.test.ts` reads the Python tuple out of the
 *  source file and asserts set equality — the same guard `REPO_SCAN_FALLBACK_CLASSES`
 *  carries. */
export const REPO_SCAN_FENCE_STATES = [
  "verified",
  "unverified_version",
  "version_unknown",
  "not_applicable",
] as const;
export type RepoScanFenceState = (typeof REPO_SCAN_FENCE_STATES)[number];

export function isRepoScanFenceState(value: unknown): value is RepoScanFenceState {
  return typeof value === "string" && (REPO_SCAN_FENCE_STATES as readonly string[]).includes(value);
}

/** The scan's disclosure about its own fence. `verified` is a claim about THIS run:
 *  true when there was nothing to fence (no in-repo agent ran) or the deny rules are
 *  verified for the CLI that ran, false in both warning states. */
export type RepoScanFence = {
  cliVersion: string | null;
  state: RepoScanFenceState;
  verified: boolean;
  /** How many symlinks the heuristic walk refused because they resolved outside the
   *  scanned root. A walk that quietly skipped half a repo under-reports it. */
  skippedSymlinks: number;
};

/** Narrow the envelope's fence block. `null` when the field is absent (a scan run by
 *  an older build) or unrecognisable — "no claim", never a green one, and never a
 *  state string the catalogs have no words for. */
export function toRepoScanFence(value: unknown): RepoScanFence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const f = value as Record<string, unknown>;
  if (!isRepoScanFenceState(f.state)) return null;
  const skipped = typeof f.skippedSymlinks === "number" && Number.isFinite(f.skippedSymlinks) ? f.skippedSymlinks : 0;
  return {
    cliVersion: typeof f.cliVersion === "string" && f.cliVersion ? f.cliVersion : null,
    state: f.state,
    // Derived from the STATE, not read from the payload: two fields that can
    // disagree is a green light waiting to happen, and the state is the one the
    // catalogs render.
    verified: f.state === "verified" || f.state === "not_applicable",
    skippedSymlinks: Math.max(0, Math.trunc(skipped)),
  };
}

export type RepoScanResult = {
  record: RepoScanRecord;
  source: "llm" | "heuristic";
  fallbackReason: Record<string, string>;
  /** The closed class Python assigned to that reason, or `null` when nothing fell
   *  back. A keyless run is NOT a fallback — it is the floor, by design. */
  fallbackClass: RepoScanFallbackClass | null;
  /** What this run can claim about the secret-file fence. `null` = the envelope
   *  carried no disclosure at all. */
  fence: RepoScanFence | null;
};

type CliEnvelope = {
  result: Record<string, unknown>;
  source: string;
  perStepSources?: Record<string, string>;
  fallbackReason?: Record<string, string>;
  fallbackClass?: string;
  fence?: unknown;
};

/** Shape-check + normalize the CLI envelope (exported pure so the parse contract is
 *  unit-testable without spawning Python). Throws on a malformed envelope — the task
 *  runner surfaces that as a failed scan, never a half-persisted dossier.
 *
 *  `source` is narrowed to the dossier vocabulary here rather than trusted: the row
 *  discloses provenance to the operator, so an unrecognised value must read as the
 *  weaker claim (`heuristic`), never as "an agent read your repo". */
export function toRepoScanEnvelope(payload: unknown): {
  result: Record<string, unknown>;
  source: "llm" | "heuristic";
  fallbackReason: Record<string, string>;
  fallbackClass: RepoScanFallbackClass | null;
  fence: RepoScanFence | null;
} {
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
    // Narrowed against the mirror of Python's own vocabulary: a class this build
    // has no word for must reach the row as "no claim", never as a chip whose
    // catalog key does not exist. `repo-scan-run.test.ts` reads the tuple out of
    // repo_scan.py and asserts the two sets are equal, so the narrowing cannot
    // silently start dropping a class Python began emitting.
    fallbackClass: isRepoScanFallbackClass(p?.fallbackClass) ? p.fallbackClass : null,
    // The dossier carries its own copy under `scanFence` (that is the one that
    // survives to the row and to the panel); the top-level block is preferred when
    // both are present, since it is the envelope's own statement about the run.
    fence: toRepoScanFence(p?.fence) ?? toRepoScanFence((r as { scanFence?: unknown }).scanFence),
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
      () =>
        finish(
          new RepoScanFailure(
            `Cloning the repository timed out after ${Math.round(CLONE_TIMEOUT_MS / 1000)}s.`,
            "clone_timeout"
          )
        ),
      CLONE_TIMEOUT_MS
    );
    const onAbort = () => finish(new RepoScanFailure("The scan was canceled.", "cancelled"));
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf-8")).slice(-400);
    });
    // A spawn `error` here is git failing to START — overwhelmingly "no such
    // binary". That is a MACHINE SETUP problem with an obvious remedy, and telling
    // the operator "install git" instead of "the scan failed" is the whole point of
    // carrying a code.
    child.once("error", () =>
      finish(new RepoScanFailure("git is not available on this machine, so a URL scan cannot run.", "git_missing"))
    );
    child.once("close", (code) => {
      if (code === 0) return finish();
      finish(
        new RepoScanFailure(
          `Could not clone the repository (git exited ${code ?? "?"}).${stderr.trim() ? ` ${stderr.trim().slice(-200)}` : ""}`,
          "clone_failed"
        )
      );
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
  lang = "en",
  /** The task runner's `ctx.progress`. Optional so a direct call (a test, a script)
   *  needs no stub — the phases are disclosure, never control flow. */
  onProgress?: (done: number, total: number, msg?: string) => void,
  /** The two EXTERNAL effects, injectable. Production never passes this; the unit
   *  test does, because the alternative is a test that clones a real repository
   *  over the network and spawns a real Python process — which is not a unit test,
   *  and is exactly how the scratch-cleanup path stayed unverified. Nothing here
   *  changes behaviour: the defaults are the real functions. */
  deps: { clone?: typeof shallowClone; spawn?: typeof spawnPython } = {}
): Promise<RepoScanResult> {
  const clone = deps.clone ?? shallowClone;
  const spawnChild = deps.spawn ?? spawnPython;
  const scanId = typeof params.scanId === "string" ? params.scanId : "";
  if (!scanId) throw new Error("repo_scan needs a scanId.");
  const scan = getRepoScanRecord(scanId, workspaceId);
  if (!scan) throw new Error(`repo scan not found: ${scanId}`);

  // A skipped transition is a fact about the RUN, not a failure of the scan: the row
  // already reached a terminal state (a reaped task the queue handed out again). Say
  // so once and carry on — the terminal writes below are guarded the same way, so
  // this run cannot overwrite the result that already stands.
  if (!markRepoScanRunning(scanId, workspaceId)) {
    console.warn(`[repo-scan] ${scanId}: skipped the running transition (row is already ${scan.status}).`);
  }
  let scratch: string | null = null;
  try {
    // Re-validate the target INSIDE the runner rather than trusting the row. The
    // row was written by a gated route, but the allow-list is process env: an
    // operator can narrow KP_APP_MASTER_REPO_ROOTS between a scan being queued and
    // it being run (a restart, a config change), and a queued scan must not outlive
    // the permission that admitted it.
    const resolved = resolveScanTarget({ repoUrl: scan.repoUrl, rootPath: scan.rootPath });
    // A refused target is the operator's own configuration (the allow-list moved
    // under a queued scan), not an engine fault — its own class, so the panel can
    // say "this path is no longer allowed" rather than "the scan failed".
    if (!resolved.ok) throw new RepoScanFailure(resolved.reason, "target_refused");

    let root = resolved.target.rootPath;
    if (!root) {
      const url = resolved.target.repoUrl!;
      if (isOffline()) {
        throw new RepoScanFailure(
          "KP_OFFLINE is set, so a remote repository cannot be cloned. Scan a local path instead.",
          "offline_refused"
        );
      }
      onProgress?.(0, PHASE_TOTAL, REPO_SCAN_PHASE.clone);
      scratch = scratchDirFor(scanId);
      await rm(scratch, { recursive: true, force: true }); // a leftover from a reaped run
      await clone(url, scratch, signal);
      root = scratch;
    }
    // A local scan reports the clone phase as ALREADY DONE (1 of 3) rather than
    // skipping the counter: the operator watching a local scan should see the same
    // three-step frame, with the step that did not apply already behind it.
    onProgress?.(1, PHASE_TOTAL, REPO_SCAN_PHASE.walk);

    // KP_LLM_CONFIG so the repo_scan use case resolves BYOM keys / model routing —
    // llm-spawn-contract.test.ts pins this call site.
    const { result } = spawnChild(
      ["-m", "pipeline.jobfit.repo_scan_cli", "--root", root, "--lang", lang, "--dossier-id", scanId,
       ...(scan.repoUrl ? ["--repo-url", scan.repoUrl] : [])],
      { signal, env: buildLlmConfigEnv() }
    );
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) throw new PipelineError(parseStderrError(stderr, exitCode));
    const envelope = toRepoScanEnvelope(parsePythonJson<unknown>(stdout, stderr));
    onProgress?.(2, PHASE_TOTAL, REPO_SCAN_PHASE.saving);

    // The fallback reason was parsed, returned and then DROPPED before the row for
    // as long as this feature has existed: the panel could see that the heuristic
    // floor had served but never why. Both halves land now — the raw line for the
    // server's log, the class for the reader's screen.
    const record = completeRepoScan(
      scanId,
      {
        dossier: envelope.result,
        source: envelope.source,
        fallbackReason: envelope.fallbackReason.repoScan ?? null,
        fallbackClass: envelope.fallbackClass,
      },
      workspaceId
    );
    if (envelope.fence && !envelope.fence.verified) {
      // Not a failure: the deny rules were still sent and the redaction backstop
      // still ran. It is the one thing the server log must not swallow — the fence
      // this build verified is not the fence this scan actually ran behind.
      console.warn(
        `[repo-scan] ${scanId}: the secret-file fence is unverified (${envelope.fence.state}` +
          `${envelope.fence.cliVersion ? `, Claude CLI ${envelope.fence.cliVersion}` : ""}).`
      );
    }
    if (envelope.fence && envelope.fence.skippedSymlinks > 0) {
      console.warn(
        `[repo-scan] ${scanId}: skipped ${envelope.fence.skippedSymlinks} symlink(s) resolving outside the scanned root.`
      );
    }
    if (envelope.fallbackClass) {
      // The class is what the operator sees; the reason line is for whoever has to
      // fix it, and it belongs in the log where a stack trace would go.
      console.warn(
        `[repo-scan] ${scanId}: the agent fell back (${envelope.fallbackClass}): ${envelope.fallbackReason.repoScan ?? "no reason given"}`
      );
    }
    if (record) {
      onProgress?.(PHASE_TOTAL, PHASE_TOTAL, REPO_SCAN_PHASE.saving);
      return {
        record,
        source: envelope.source,
        fallbackReason: envelope.fallbackReason,
        fallbackClass: envelope.fallbackClass,
        fence: envelope.fence,
      };
    }

    // The complete did not apply. Either the row moved to a terminal state while this
    // run was working (cancelled, reaped-and-rerun) — in which case the row that
    // stands is the answer and this result is dropped — or it is genuinely gone.
    const current = getRepoScanRecord(scanId, workspaceId);
    if (!current) throw new Error(`repo scan disappeared while running: ${scanId}`);
    console.warn(`[repo-scan] ${scanId}: skipped the complete transition (row is already ${current.status}).`);
    return {
      record: current,
      source: envelope.source,
      fallbackReason: envelope.fallbackReason,
      fallbackClass: envelope.fallbackClass,
      fence: envelope.fence,
    };
  } catch (error) {
    // The row is the thing the operator polls, so a failure has to land ON it — not
    // only on the task. `failed` with a reason beats a row stuck at `running`, and a
    // failed row with a CODE beats one that can only say "failed": "git is not
    // installed" and "offline mode refuses clones" are different problems with
    // different remedies, and the operator is the one who has to pick.
    const message = error instanceof Error ? error.message : "The repository scan failed.";
    const code = classifyRepoScanError(error, signal);
    if (!failRepoScan(scanId, message, code, workspaceId)) {
      console.warn(`[repo-scan] ${scanId}: skipped the failed transition (the row is no longer running).`);
    }
    throw error;
  } finally {
    if (scratch) {
      // Best effort, by design: a clone we could not delete is a temp-dir problem,
      // not a reason to fail a scan that otherwise succeeded.
      await rm(scratch, { recursive: true, force: true }).catch(() => {});
    }
  }
}
