import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { positiveNumericEnv } from "./env";
import { currentLlmRequestId } from "./llm-request-context";

// Fold a finished spawn's LLM-usage sidecar (NDJSON written by Python's
// monitor.emit_result) into the llm_usage ledger, then delete it. Lazy dynamic
// import so the generic process runner doesn't eagerly pull in the DB layer, and
// fully swallowed — the metering ledger is telemetry and must never affect the
// spawn it rides on. A spawn with no LLM call leaves no file (a harmless no-op).
async function ingestUsageLog(logPath: string): Promise<void> {
  try {
    const { ingestLlmUsageLog } = await import("./db/llm");
    ingestLlmUsageLog(logPath);
  } catch {
    /* ledger off the critical path */
  }
}

const PYTHON_CMD = process.env.PYTHON_CMD ?? (process.platform === "win32" ? "python" : "python3");

// LLM-usage metering is ON BY DEFAULT: every spawn gets a per-call sidecar path so
// the flagship CV-analysis (and every other CLI's) spend lands in the llm_usage
// ledger. An operator opts OUT by setting KP_LLM_USAGE_LOG to an explicit off token
// — we then DON'T mint a sidecar (nothing to meter or ingest), and pass the token
// through so the Python monitor also treats it as disabled. Mirrors monitor._LEDGER_OFF_TOKENS.
const LEDGER_OFF_TOKENS = new Set(["0", "off", "false", "no", "disable", "disabled"]);
function meteringOptOut(): string | null {
  const raw = process.env.KP_LLM_USAGE_LOG;
  if (raw && LEDGER_OFF_TOKENS.has(raw.trim().toLowerCase())) return raw;
  return null;
}

export type PythonError = {
  message: string;
  status: number;
  // Stable, machine-readable code (e.g. "invalid_input" / "not_found" /
  // "engine_error") the UI can branch on without string-matching the human
  // message. Absent for CLIs that don't emit one yet.
  code?: string;
};

// Carries the Python CLI's status/code through a thrown Error so callers can tell
// a user-fixable 400 (render an inline hint) from a 500 engine failure
// (retry/escalate) — instead of collapsing both into a bare `new Error(message)`.
export class PipelineError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(err: PythonError) {
    super(err.message);
    this.name = "PipelineError";
    this.status = err.status;
    this.code = err.code;
  }
}

export async function createWorkdir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "jobfit-"));
}

export async function cleanupWorkdir(workdir: string): Promise<void> {
  await rm(workdir, { recursive: true, force: true });
}

export async function persistFile(workdir: string, file: File, baseName: string): Promise<string> {
  const suffix = path.extname(file.name) || ".txt";
  const target = path.join(workdir, `${baseName}${suffix}`);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(target, buffer);
  return target;
}

export type SpawnResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

export type SpawnOptions = {
  // Wall-clock safety net. A genuinely hung child (stalled network call in a
  // provider, a deadlocked subprocess) is SIGKILLed and the promise rejects,
  // instead of leaking a process and hanging the caller forever. Generous by
  // default so legitimate multi-LLM CLIs are never killed mid-run.
  timeoutMs?: number;
  // Lets a caller (e.g. a cancelled request/task) abort the child early.
  signal?: AbortSignal;
  // Hard ceiling on the combined stdout+stderr bytes we buffer in the Node
  // heap. Crossing it SIGKILLs the child and rejects with an
  // 'output exceeded N MB' error naming the CLI, instead of letting a runaway
  // child grow the buffer unbounded and OOM the whole process.
  maxBufferBytes?: number;
  // Per-spawn env additions merged over process.env — e.g. KP_LLM_CONFIG from
  // llm-config.ts so the Python LLM registry sees the configured routing.
  env?: Record<string, string | undefined>;
};

const DEFAULT_TIMEOUT_MS = 600_000; // 10 min — a hang backstop, not a deadline.

// Hard ceiling on how much stdout+stderr spawnPython buffers in memory before
// killing the child. The CLIs emit a single JSON line — KBs, occasionally a few
// hundred KB with grounding dumps — so this is a runaway backstop, not a normal
// limit. Without it a chatty/runaway child (an accidental infinite print, a
// library logging in a loop, a multi-MB base64 blob) accumulates its entire
// output in the heap until close — up to DEFAULT_TIMEOUT_MS — and can OOM the
// Next.js process, taking down every route, not just the one that spawned it.
// This caps the child's *output*, NOT the user's *input*: the max upload size a
// user can submit is the separate per-file MAX_FILE_BYTES (8 MB) contract in
// app/_lib/upload-constraints.ts, enforced at the route boundary. 64 MB sits
// far above any expected result so a legitimate grounding dump is never
// truncated by it. Overridable via PYTHON_MAX_BUFFER_MB for operability
// (matching PYTHON_CMD).
const DEFAULT_MAX_BUFFER_BYTES = positiveNumericEnv("PYTHON_MAX_BUFFER_MB", 64, {
  scale: 1024 * 1024,
});

// ---- Process-wide spawn ceiling ---------------------------------------------
//
// Every request that needs the engine used to fork its OWN CPython interpreter with
// nothing counting them. One interpreter that imports the jobfit package is ~120-200 MB
// RSS and saturates a core for the length of an LLM round-trip, so N simultaneous
// analyze/match/devcase calls are N interpreters — and the failure is not a slow queue,
// it is the Node server itself being starved or OOM-killed, which takes down every
// route rather than the one that overcommitted.
//
// So spawns run under ONE process-wide semaphore. This is admission control, not a
// scheduler: a caller waits a bounded time for a slot and is REFUSED (503 ENGINE_BUSY)
// rather than queued indefinitely, because the callers are HTTP requests whose client
// has its own deadline — an unbounded queue only converts an overload into a pile of
// sockets holding memory while their users have already given up.
//
// DEFAULT 4. kp self-hosts on small boxes (the chart's request floor is 2 vCPU); 4 lets
// a recruiter's parallel board actions genuinely overlap while keeping worst-case
// engine RSS under ~1 GB and leaving a core for Next itself. Raise it on a bigger host
// with KP_PYTHON_MAX_CONCURRENT; 1 makes the engine strictly serial.
//
// SINGLE PROCESS, like rate-limit.ts: the counter lives in this Node process. kp runs as
// one server, and a horizontally-scaled deployment would need the same swap behind the
// same function shape (documented in docs/architecture/self-hosting.md).
const DEFAULT_MAX_CONCURRENT = 4;
// How long a caller waits for a slot before the door answers "busy". 20s is well inside
// a normal fetch deadline and far below the 600s hang backstop, so a queued request
// still has time to run a real spawn after it is admitted.
const DEFAULT_QUEUE_WAIT_MS = 20_000;

/** The engine's overload code — thrown as a {@link PipelineError} with status 503 so the
 *  routes' existing PipelineError mapping forwards it like any other engine refusal.
 *
 *  UPPERCASE, unlike PYTHON_ERROR_CODES: those are the ENGINE's own vocabulary, emitted
 *  by _cli.py. This one is KP's — the child never ran, there is no CLI to have named it —
 *  so it is a REFUSAL_ERRORS code the client resolves as `errors.ENGINE_BUSY` in the
 *  reader's language. The message below is REFUSAL_ERRORS.ENGINE_BUSY verbatim, kept as a
 *  literal here so the generic process runner does not pull next/server in through
 *  api-response.ts; change one and change the other. */
export const ENGINE_BUSY_CODE = "ENGINE_BUSY";

function maxConcurrentSpawns(): number {
  return Math.max(1, Math.floor(positiveNumericEnv("KP_PYTHON_MAX_CONCURRENT", DEFAULT_MAX_CONCURRENT)));
}
function queueWaitMs(): number {
  return positiveNumericEnv("KP_PYTHON_QUEUE_WAIT_MS", DEFAULT_QUEUE_WAIT_MS);
}

type SlotWaiter = { admit: () => void };
let inFlightSpawns = 0;
const slotWaiters: SlotWaiter[] = [];

/** Live admission state — for tests, and for an ops surface that wants to say whether
 *  the engine is saturated rather than merely slow. */
export function pythonSpawnLoad(): { inFlight: number; queued: number; ceiling: number } {
  return { inFlight: inFlightSpawns, queued: slotWaiters.length, ceiling: maxConcurrentSpawns() };
}

/** Hand the freed slot straight to the longest-waiting caller (FIFO), so a burst is
 *  served in arrival order instead of letting a late caller barge in. `inFlightSpawns`
 *  is unchanged on a hand-over — the slot never becomes free, it changes owner. */
function releaseSlot(): void {
  const next = slotWaiters.shift();
  if (next) {
    next.admit();
    return;
  }
  inFlightSpawns = Math.max(0, inFlightSpawns - 1);
}

function acquireSlot(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new Error("Python process aborted"));
  if (inFlightSpawns < maxConcurrentSpawns()) {
    inFlightSpawns += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    let done = false;
    const drop = (): void => {
      const i = slotWaiters.indexOf(waiter);
      if (i >= 0) slotWaiters.splice(i, 1);
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const waiter: SlotWaiter = {
      admit: () => {
        if (done) return;
        done = true;
        drop();
        resolve();
      },
    };
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      drop();
      reject(
        new PipelineError({
          message: "The analysis engine is busy right now. Try again in a moment.",
          status: 503,
          code: ENGINE_BUSY_CODE,
        }),
      );
    }, queueWaitMs());
    const onAbort = (): void => {
      if (done) return;
      done = true;
      drop();
      reject(new Error("Python process aborted"));
    };
    slotWaiters.push(waiter);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Kill the child AND everything it started.
 *
 *  `child.kill()` signals ONE pid. The engine's CLIs routinely shell out — the Claude
 *  CLI adapter spawns `claude`, repo scans spawn `git` — so a timeout or an abandoned
 *  request killed the interpreter and left its grandchild running, holding the CPU and
 *  the provider connection the kill was supposed to reclaim, until the box was
 *  restarted. Both platforms need their own mechanism:
 *
 *  - POSIX: the child is spawned `detached`, which makes it a PROCESS GROUP LEADER, and
 *    everything it forks inherits that group. `process.kill(-pid, …)` signals the whole
 *    group. (`detached` here does NOT mean "outlive us" — we never `unref()`, and this
 *    function is the only thing that reaps it.) A group that has already exited throws
 *    ESRCH; we fall back to the single-pid kill so an ordinary race is not an error.
 *  - Windows: there are no process groups to signal, and `detached` would give the child
 *    its own console. `taskkill /T /F` walks the parent-pid tree instead and is the
 *    documented way to end a subtree. taskkill must be given the chance to ENUMERATE
 *    that tree, so the direct `child.kill()` is NOT fired alongside it — measured on
 *    Windows: killing the child first orphans its descendants before taskkill reads
 *    them, and a grandchild that detached itself then survives, which is the exact bug
 *    this function exists to fix. The direct kill is the FALLBACK, run only when
 *    taskkill cannot start (missing from a stripped image) or exits non-zero.
 */
function killProcessTree(child: ChildProcessWithoutNullStreams): void {
  const pid = child.pid;
  if (process.platform === "win32") {
    const fallback = (): void => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    };
    if (pid == null) return fallback();
    try {
      const reaper = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      // taskkill missing from PATH must not throw an unhandled 'error' event out of a
      // kill path — and either failure mode leaves the child alive, so fall back.
      reaper.on("error", fallback);
      reaper.on("exit", (code) => {
        // 128 = "process not found": it already exited, which is the outcome we wanted.
        if (code !== 0 && code !== 128) fallback();
      });
    } catch {
      fallback();
    }
    return;
  }
  if (pid != null) {
    try {
      process.kill(-pid, "SIGKILL");
      return;
    } catch {
      /* the group is already gone, or the child never became a leader — fall through */
    }
  }
  try {
    child.kill("SIGKILL");
  } catch {
    /* already gone */
  }
}

export function spawnPython(
  args: string[],
  opts: SpawnOptions = {},
): {
  result: Promise<SpawnResult>;
} {
  // Per-spawn LLM-usage ledger sidecar: Python's monitor appends one NDJSON line
  // per metered call to this path; we fold it into llm_usage once the child
  // settles (below). Unique per spawn so there are no cross-process append races
  // and each file is ingested exactly once. Set for EVERY spawn — a non-LLM CLI
  // simply never creates it. opts.env can override it if a caller needs to.
  // Default: a fresh sidecar path (metering ON). Opt-out: reuse the operator's off
  // token so the child meters nothing and we skip ingest below.
  const optOut = meteringOptOut();
  const usageLogPath = optOut ?? path.join(os.tmpdir(), `kp-llm-usage-${process.pid}-${randomUUID()}.ndjson`);
  // The run this spawn belongs to, if any — the ambient task id opened by the
  // background-task runner (llm-request-context.ts). Python stamps it onto each
  // ledger line as `request_id`, which is how an Insights → Activity row finds
  // the task whose output it produced. Null outside a task scope (a route that
  // spawns Python inline, a CLI, a test): the row simply has no linked run, and
  // the Activity detail degrades to the ledger fields alone. Only set when
  // present so a scope-less spawn inherits nothing from a stale parent env.
  //
  // READ SYNCHRONOUSLY, before the admission await below: it comes from an
  // AsyncLocalStorage scope the CALLER owns, and a queued spawn resumes on a
  // microtask that may no longer be inside it.
  const llmRequestId = currentLlmRequestId();
  // Admission first, fork second (see the semaphore header): the interpreter is not
  // started until a slot is held, which is the whole point — counting spawns after
  // starting them would bound nothing.
  const result = (async (): Promise<SpawnResult> => {
    await acquireSlot(opts.signal);
    try {
      return await runPythonChild(args, opts, usageLogPath, llmRequestId);
    } finally {
      releaseSlot();
    }
  })();
  // Ingest the usage sidecar once the child has settled (close, error, timeout,
  // or abort — all kill the child, so no further lines are written). Detached
  // from `result` so it neither delays nor alters what the caller awaits, and its
  // own rejection is swallowed. A spawn refused at the door (ENGINE_BUSY) wrote no
  // sidecar, and ingestUsageLog treats a missing file as a no-op.
  // Skip ingest entirely when the operator opted out — usageLogPath is their token
  // (e.g. "0"), not a real sidecar, so there is nothing to fold in.
  if (!optOut) void result.finally(() => ingestUsageLog(usageLogPath)).catch(() => {});
  return { result };
}

/** The actual fork + settle. Split out of {@link spawnPython} so the semaphore can wrap
 *  it: everything here runs only once a slot is held. */
function runPythonChild(
  args: string[],
  opts: SpawnOptions,
  usageLogPath: string,
  llmRequestId: string | null,
): Promise<SpawnResult> {
  const child = spawn(PYTHON_CMD, args, {
    // cwd defaults to the parent's process.cwd() (the project root, where the
    // `pipeline` package is importable for `python -m`); passing it explicitly is
    // redundant and made Turbopack's file tracer over-include the project root.
    // Force UTF-8 for the child's stdio + subprocess I/O so Czech diacritics
    // survive on Windows (whose default locale is cp1250). PYTHONUTF8=1 also
    // makes any nested subprocess.run(text=True) default to UTF-8.
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
      KP_LLM_USAGE_LOG: usageLogPath,
      ...(llmRequestId ? { KP_LLM_REQUEST_ID: llmRequestId } : {}),
      ...(opts.env ?? {}),
    },
    // POSIX only: make the child a process-group leader so killProcessTree can signal
    // the WHOLE group (the interpreter plus every `claude` / `git` it shells out to).
    // Never on Windows, where `detached` allocates a console instead and the tree is
    // reaped by taskkill /T. We never unref(), so this does not outlive us.
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  // bug-ui-scan-2026-07-09 (pipeline-clis-script-bridges #3): close the child's
  // stdin immediately. The bridge never writes to it, but several CLIs fall back
  // to `json.loads(sys.stdin.read() or "{}")` when their --input flag is absent
  // (e.g. a refactor drops/renames the flag). With the default stdio the child's
  // stdin is an open pipe that never gets EOF, so that fallback would block until
  // the 600s timeout — a mysterious slow/hung endpoint. Ending it now makes an
  // unfed stdin read EOF instantly, so a missing-flag regression fails fast.
  child.stdin.end();
  // Keep streams in Buffer mode so the streaming route can attach its own
  // TextDecoder. Encoding is applied once at process close.
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  return new Promise<SpawnResult>((resolve, reject) => {
    let settled = false;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxBufferBytes = opts.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
    let bufferedBytes = 0;

    const cleanup = () => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      // The child's own descendants die with it — see killProcessTree.
      killProcessTree(child);
      reject(err);
    };

    // Accumulate output while tracking a running byte total. A runaway child
    // would otherwise buffer its entire output until close (up to timeoutMs)
    // and OOM the process; once stdout+stderr crosses the ceiling we SIGKILL
    // (via fail) and reject with an attributable error naming the CLI.
    const onChunk = (chunks: Buffer[], chunk: Buffer) => {
      if (settled) return;
      chunks.push(chunk);
      bufferedBytes += chunk.length;
      if (bufferedBytes > maxBufferBytes) {
        fail(
          new Error(
            `Python process output exceeded ${Math.round(maxBufferBytes / (1024 * 1024))} MB and was terminated: ${args.join(" ")}`,
          ),
        );
      }
    };
    child.stdout.on("data", (chunk: Buffer) => onChunk(stdoutChunks, chunk));
    child.stderr.on("data", (chunk: Buffer) => onChunk(stderrChunks, chunk));

    const timer = setTimeout(
      () => fail(new Error(`Python process timed out after ${Math.round(timeoutMs / 1000)}s: ${args.join(" ")}`)),
      timeoutMs,
    );
    const onAbort = () => fail(new Error("Python process aborted"));
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        exitCode: code,
      });
    });
  });
}

/**
 * Parse the JSON result a Python CLI prints to stdout. The CLIs emit one
 * json.dumps line as their final payload, but stray non-JSON lines can land on
 * either side of it: an underlying library can print a warning to stdout
 * *before* the result, and the interpreter routinely prints *after* it at
 * shutdown — atexit handlers, ResourceWarning, asyncio "Event loop is closed",
 * and multiprocessing resource_tracker "leaked semaphore" lines. So rather than
 * blindly taking the last non-empty line (which a trailing shutdown line would
 * turn into a parse failure, 500ing an otherwise-successful run) we scan the
 * non-empty lines from the END and return the first that parses to a JSON
 * object or array. This is robust to trailing chatter without weakening the
 * before-the-json protection. Bare scalars (a number/string/bool a warning line
 * might be, e.g. `42` or `"done"`) are skipped so they can't masquerade as the
 * result — every CLI's payload is an object or array. On failure we throw an
 * error embedding stdout+stderr for diagnosis instead of a bare
 * "Unexpected token in JSON".
 */
export function parsePythonJson<T>(stdout: string, stderr = ""): T {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[i]);
    } catch {
      continue; // not JSON (trailing shutdown noise / a pre-result warning) — keep scanning
    }
    if (parsed !== null && typeof parsed === "object") {
      return parsed as T;
    }
  }
  const detail = [
    stdout.trim() && `stdout: …${stdout.trim().slice(-400)}`,
    stderr.trim() && `stderr: …${stderr.trim().slice(-400)}`,
  ]
    .filter(Boolean)
    .join(" | ");
  throw new Error(`Python returned non-JSON output${detail ? ` — ${detail}` : ""}.`);
}

// The engine's failure vocabulary, mirrored from pipeline/jobfit/_cli.py::ERROR_CODES
// and pinned to it by pipeline/jobfit/tests/test_cli_error_envelope.py. A code outside
// this set is still forwarded (the CLI family predates the shared scaffold and some
// members emit their own, e.g. "rate_limited"); the list exists so the DERIVED codes
// below and the Python side cannot silently disagree on spelling.
export const PYTHON_ERROR_CODES = ["invalid_input", "not_found", "engine_error", "timeout"] as const;

// Default code derived from status when the CLI didn't emit an explicit one
// (older CLIs, or argparse usage errors that exit 2 with plain-text stderr).
function codeForStatus(status: number): string {
  if (status === 404) return "not_found";
  if (status === 504) return "timeout";
  return status === 400 ? "invalid_input" : "engine_error";
}

// An EMITTED code wins over the status-derived guess — that is the whole point of the
// engine naming its own failures. But only a non-blank one: `{"code": ""}` (or a
// whitespace-only field from a half-built envelope) used to pass the bare
// `typeof === "string"` test and win, handing the client an empty code that
// `useErrorMessage` cannot resolve to any `errors.<CODE>` key — strictly worse than
// the guess it displaced. Blank falls back to the derivation.
function emittedCode(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

export function parseStderrError(stderr: string, exitCode: number | null): PythonError {
  const trimmed = stderr.trim();
  const lastLine = trimmed.split(/\r?\n/).filter(Boolean).pop() ?? "";
  try {
    const parsed = JSON.parse(lastLine);
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      const message = typeof record.error === "string" ? record.error : "Pipeline failed.";
      const status = typeof record.status === "number" ? record.status : exitCode === 2 ? 400 : 500;
      const code = emittedCode(record.code) ?? codeForStatus(status);
      return { message, status, code };
    }
  } catch {
    // not JSON
  }
  const status = exitCode === 2 ? 400 : 500;
  return {
    message: trimmed || `Pipeline exited with code ${exitCode ?? "?"}.`,
    status,
    code: codeForStatus(status),
  };
}
