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
};

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
};

const DEFAULT_TIMEOUT_MS = 600_000; // 10 min — a hang backstop, not a deadline.

export function spawnPython(
  args: string[],
  opts: SpawnOptions = {},
): {
  child: ChildProcessWithoutNullStreams;
  result: Promise<SpawnResult>;
} {
  const child = spawn(PYTHON_CMD, args, {
    cwd: process.cwd(),
    env: process.env,
    windowsHide: true,
  });
  // Keep streams in Buffer mode so the streaming route can attach its own
  // TextDecoder. Encoding is applied once at process close.
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutChunks.push(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk);
  });
  const result = new Promise<SpawnResult>((resolve, reject) => {
    let settled = false;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

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
 * json.dumps line as their final output, but an underlying library can print a
 * stray warning to stdout first — so we parse the LAST non-empty line rather
 * than the whole buffer, and on failure throw an error embedding stdout+stderr
 * for diagnosis instead of a bare "Unexpected token in JSON".
 */
export function parsePythonJson<T>(stdout: string, stderr = ""): T {
  const lastLine = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() ?? "";
  try {
    return JSON.parse(lastLine) as T;
  } catch {
    const detail = [
      stdout.trim() && `stdout: …${stdout.trim().slice(-400)}`,
      stderr.trim() && `stderr: …${stderr.trim().slice(-400)}`,
    ]
      .filter(Boolean)
      .join(" | ");
    throw new Error(`Python returned non-JSON output${detail ? ` — ${detail}` : ""}.`);
  }
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
      return { message, status };
    }
  } catch {
    // not JSON
  }
  return {
    message: trimmed || `Pipeline exited with code ${exitCode ?? "?"}.`,
    status: exitCode === 2 ? 400 : 500,
  };
}
