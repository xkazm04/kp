import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// A dev server on an UNSEEDED, deleted-before-start database — the one thing the
// suite's managed webServer (KP_SEED_DEMO=1, data/kp-e2e.sqlite) cannot give the
// first-run data choice. Two dev servers cannot share a checkout (Next's lock is
// .next/dev/lock, and a second `next dev` only reports "existing server"), and
// KP_EMPTY=1 — the only other distDir — answers the choice by env, so each fresh
// database is a fresh server PROCESS, started and stopped by the spec itself.
// playwright.config.ts drops the managed webServer for that run.

export const FRESH_PORT = 3102;
export const FRESH_ORIGIN = `http://localhost:${FRESH_PORT}`;
const ROOT = path.resolve(import.meta.dirname, "..", "..");
export const FRESH_DB_PATH = path.join(ROOT, "data", "kp-first-run.sqlite");

function deleteDb(): void {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${FRESH_DB_PATH}${suffix}`, { force: true });
}

async function listening(): Promise<boolean> {
  try {
    await fetch(FRESH_ORIGIN, { signal: AbortSignal.timeout(2_000) });
    return true;
  } catch {
    return false;
  }
}

export type FreshServer = { stop: () => Promise<void> };

/** Deletes the database file, then boots `next dev` with no KP_SEED_DEMO / KP_EMPTY /
 *  KP_OPERATOR_PASSWORD, so the first request meets a genuinely first-run install. */
export async function startFreshServer(): Promise<FreshServer> {
  if (await listening()) throw new Error(`:${FRESH_PORT} is already serving; stop it so the database can be reset`);
  deleteDb();
  const env: NodeJS.ProcessEnv = { ...process.env, KP_DB_PATH: FRESH_DB_PATH };
  for (const key of ["KP_SEED_DEMO", "KP_EMPTY", "KP_OPERATOR_PASSWORD"]) delete env[key];
  const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  const child: ChildProcess = spawn(process.execPath, [nextBin, "dev", "--port", String(FRESH_PORT)], {
    cwd: ROOT,
    env,
    stdio: "ignore",
    detached: process.platform !== "win32"
  });
  const exited = new Promise<never>((_, reject) => child.once("exit", (code) => reject(new Error(`next dev exited early (${code})`))));
  const ready = (async () => {
    const deadline = Date.now() + 100_000;
    while (Date.now() < deadline) {
      if (await listening()) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("fresh dev server did not come up");
  })();
  try {
    await Promise.race([ready, exited]);
  } catch (error) {
    kill(child);
    throw error;
  }
  return {
    stop: async () => {
      kill(child);
      for (let i = 0; i < 40 && (await listening()); i++) await new Promise((r) => setTimeout(r, 250));
    }
  };
}

function kill(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      /* best-effort: the process group is already gone */
    }
  }
}
