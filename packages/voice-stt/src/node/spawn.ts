// Shared subprocess plumbing for the local adapters: timeout, kill-on-timeout,
// abort, hidden console on Windows, and a scratch dir that names its reaper.
//
// The scratch dir matters more here than it does for synthesis: what lands in
// it is a candidate's voice, not the product's own sentence. The `finally`
// removal is the only thing standing between "we transcribed an interview" and
// "we left the interview audio in the OS temp folder", so callers never own it.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SttError, type SttProviderId } from "../types.ts";

export type RunResult = { code: number | null; stdout: string; stderr: string; ms: number };

export async function runSidecar(
  provider: SttProviderId,
  bin: string,
  args: string[],
  opts: { timeoutMs: number; signal?: AbortSignal; cwd?: string },
): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    const started = Date.now();
    const child = spawn(bin, args, { cwd: opts.cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new SttError("timeout", `${path.basename(bin)} exceeded ${opts.timeoutMs}ms`, provider)));
    }, opts.timeoutMs);
    const onAbort = () => {
      child.kill();
      finish(() => reject(new SttError("aborted", "transcription aborted", provider)));
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (d) => (stdout += String(d)));
    child.stderr?.on("data", (d) => (stderr += String(d)));
    child.on("error", (err) => finish(() => reject(new SttError("engine_failed", `${path.basename(bin)}: ${err.message}`, provider))));
    child.on("close", (code) => finish(() => resolve({ code, stdout, stderr, ms: Date.now() - started })));
  });
}

/** A scratch dir whose reaper is the finally block — callers never clean up. */
export async function withScratchDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function writeAudio(dir: string, name: string, bytes: Uint8Array): Promise<string> {
  const file = path.join(dir, name);
  await writeFile(file, bytes);
  return file;
}

export async function readJson<T>(file: string, provider: SttProviderId): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (err) {
    throw new SttError("engine_failed", `no transcript produced: ${(err as Error).message}`, provider);
  }
}
