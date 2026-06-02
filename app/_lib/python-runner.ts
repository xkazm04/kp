import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PYTHON_CMD = process.env.PYTHON_CMD ?? (process.platform === "win32" ? "python" : "python3");

export type AnalyzeOptions = {
  grounding: boolean;
  cvFile: File;
  jobDescriptionFile?: File | null;
  jobDescriptionText?: string | null;
  companyFile?: File | null;
  companyText?: string | null;
};

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

export function buildCliArgs(options: AnalyzeOptions, paths: {
  cvPath: string;
  jobDescriptionPath?: string;
  companyPath?: string;
}): string[] {
  const args = ["-m", "pipeline.jobfit.cli", paths.cvPath];
  if (options.grounding) args.push("--grounding");
  if (paths.jobDescriptionPath) {
    args.push("--job-description-path", paths.jobDescriptionPath);
  } else if (options.jobDescriptionText && options.jobDescriptionText.trim()) {
    args.push("--job-description-text", options.jobDescriptionText.trim());
  }
  if (paths.companyPath) {
    args.push("--company-path", paths.companyPath);
  } else if (options.companyText && options.companyText.trim()) {
    args.push("--company-text", options.companyText.trim());
  }
  return args;
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
};

const DEFAULT_TIMEOUT_MS = 600_000; // 10 min — a hang backstop, not a deadline.

// Hard ceiling on how much stdout+stderr spawnPython buffers in memory before
// killing the child. The CLIs emit a single JSON line — KBs, occasionally a few
// hundred KB with grounding dumps — so this is a runaway backstop, not a normal
// limit. Without it a chatty/runaway child (an accidental infinite print, a
// library logging in a loop, a multi-MB base64 blob) accumulates its entire
// output in the heap until close — up to DEFAULT_TIMEOUT_MS — and can OOM the
// Next.js process, taking down every route, not just the one that spawned it.
// Overridable via PYTHON_MAX_BUFFER_MB for operability (matching PYTHON_CMD).
const DEFAULT_MAX_BUFFER_BYTES = (() => {
  const mb = Number(process.env.PYTHON_MAX_BUFFER_MB);
  return Number.isFinite(mb) && mb > 0 ? Math.floor(mb * 1024 * 1024) : 64 * 1024 * 1024;
})();

export function spawnPython(
  args: string[],
  opts: SpawnOptions = {},
): {
  child: ChildProcessWithoutNullStreams;
  result: Promise<SpawnResult>;
} {
  const child = spawn(PYTHON_CMD, args, {
    // cwd defaults to the parent's process.cwd() (the project root, where the
    // `pipeline` package is importable for `python -m`); passing it explicitly is
    // redundant and made Turbopack's file tracer over-include the project root.
    // Force UTF-8 for the child's stdio + subprocess I/O so Czech diacritics
    // survive on Windows (whose default locale is cp1250). PYTHONUTF8=1 also
    // makes any nested subprocess.run(text=True) default to UTF-8.
    env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
    windowsHide: true,
  });
  // Keep streams in Buffer mode so the streaming route can attach its own
  // TextDecoder. Encoding is applied once at process close.
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const result = new Promise<SpawnResult>((resolve, reject) => {
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
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
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
  return { child, result };
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

// Default code derived from status when the CLI didn't emit an explicit one
// (older CLIs, or argparse usage errors that exit 2 with plain-text stderr).
function codeForStatus(status: number): string {
  if (status === 404) return "not_found";
  return status === 400 ? "invalid_input" : "engine_error";
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
      const code = typeof record.code === "string" ? record.code : codeForStatus(status);
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
