// Shared subprocess plumbing for the local adapters: timeout, kill-on-timeout,
// abort, hidden console on Windows, and a scratch dir that names its reaper.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TtsError, type TtsProviderId } from "../types.ts";

export type RunResult = { code: number | null; stderr: string; ms: number };

export async function runSidecar(
  provider: TtsProviderId,
  bin: string,
  args: string[],
  opts: { stdin?: string; timeoutMs: number; signal?: AbortSignal; cwd?: string },
): Promise<RunResult> {
  const started = Date.now();
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      windowsHide: true,
      stdio: [opts.stdin != null ? "pipe" : "ignore", "ignore", "pipe"],
    });
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
      finish(() => reject(new TtsError("timeout", `${path.basename(bin)} exceeded ${opts.timeoutMs}ms`, provider)));
    }, opts.timeoutMs);
    const onAbort = () => {
      child.kill();
      finish(() => reject(new TtsError("aborted", "synthesis aborted", provider)));
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.stderr?.on("data", (d) => (stderr += String(d)));
    child.on("error", (err) => finish(() => reject(new TtsError("engine_failed", `${path.basename(bin)}: ${err.message}`, provider))));
    child.on("close", (code) => finish(() => resolve({ code, stderr, ms: Date.now() - started })));
    if (opts.stdin != null) {
      child.stdin?.on("error", () => {});
      child.stdin?.end(opts.stdin);
    }
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

export async function readWav(file: string, provider: TtsProviderId): Promise<Uint8Array> {
  try {
    const buf = await readFile(file);
    if (buf.length < 44) throw new Error("output shorter than a WAV header");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch (err) {
    throw new TtsError("engine_failed", `no audio produced: ${(err as Error).message}`, provider);
  }
}
