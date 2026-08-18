// Shared per-process isolated-DB bootstrap for the behavioral store/route tests
// run by `npm run test:unit` (node --test; each test FILE runs in its own child
// process, so this module executes once per file).
//
// IMPORT ORDER IS LOAD-BEARING: import this module BEFORE any module that
// (transitively) touches app/_lib/db-path.ts. DB_PATH is computed from
// KP_DB_PATH at db-path's module-evaluation time, so this module must set the
// env var first — ESM evaluates imports in source order, which makes
// `import { ... } from "../testing/unit-db.ts"` as the first project import
// sufficient. Every store then opens a throwaway SQLite file unique to this
// process, so parallel test files can never collide with each other or with a
// developer's real data/kp.sqlite.
//
// Cleanup: `cleanupUnitDb()` (call it from `after(...)`) closes the main
// connection and best-effort deletes the temp dir. The isolated-connection
// stores (offers, scheduler, …) hold private handles with no close
// API, and Windows refuses to delete a file another handle keeps open — so each
// run ALSO sweeps stale dirs left by previous runs (mtime-gated so concurrently
// running test files can't sweep each other).

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Deterministic env: none of these may leak from a developer's shell into the
// behavioral assertions (open auth mode, no comms relay, no billing provider,
// default TTL/scheduler policies). Tests that need one set it explicitly.
for (const key of [
  "KP_OPERATOR_PASSWORD",
  "COMMS_WEBHOOK_URL",
  "AUTOMATION_SCHEDULER_AUTOSTART",
  "POLAR_ACCESS_TOKEN",
  "POLAR_WEBHOOK_SECRET",
  "POLAR_SERVER",
  "POLAR_PRODUCT_STARTER",
  "POLAR_PRODUCT_GROWTH",
  "POLAR_PRODUCT_BYOM",
  "POLAR_PRODUCT_MINUTE_PACK",
  "KP_OFFER_TTL_DAYS",
  "KP_OFFER_REMINDER_LEAD_HOURS",
  "KP_CONSENT_TTL_DAYS",
  "KP_MULTI_WORKSPACE",
  "APP_BASE_URL",
  "NEXT_PUBLIC_APP_BASE_URL",
  // A stray postgres DATABASE_URL / KP_DB_BACKEND in a dev shell would make
  // openStore's resolveDbBackend() throw (E-SH-3); KP_OFFLINE would flip egress
  // gating. Clear them so store tests are deterministic regardless of shell env.
  "DATABASE_URL",
  "KP_DB_BACKEND",
  "KP_OFFLINE",
  // A dev shell paired with a live Personas app would flip resolveBridge() to
  // "env" and make bridge/dispatch tests hit a real endpoint. Tests that need
  // the override set it explicitly.
  "PERSONAS_BRIDGE_URL",
  "PERSONAS_BRIDGE_KEY",
]) {
  delete process.env[key];
}

const ROOT = path.join(tmpdir(), "kp-unit-db");
mkdirSync(ROOT, { recursive: true });

// Sweep leftovers from PREVIOUS runs. Only dirs untouched for >15 minutes AND whose
// owning process is dead are removed (see isSweepable): on POSIX an unguarded rm would
// unlink a live sibling's open SQLite file mid-test.
const STALE_MS = 15 * 60 * 1000;

/** Whether the process that created `dir` is still alive, read from the `pid` marker this
 *  module writes into every run dir. A missing/malformed marker → treated as dead so
 *  legacy leftovers still get reclaimed via the mtime path. Exported for the sweep test. */
export function ownerAlive(dir: string): boolean {
  let pid: number;
  try {
    pid = Number.parseInt(readFileSync(path.join(dir, "pid"), "utf8").trim(), 10);
  } catch {
    return false; // no marker → can't prove liveness → let mtime decide
  }
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true; // our own dir
  try {
    process.kill(pid, 0); // signal 0 = existence probe; sends nothing
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // exists but not ours → alive
  }
}

/** bug-ui-scan-2026-07-09 (data-store-persistence #5): the old sweep gated on the run
 *  DIRECTORY's mtime alone. Directory mtime bumps on entry add/remove — NOT on writes to an
 *  existing file — so a long test that created its kp.sqlite early then only wrote to it had
 *  a stale dir mtime while very much alive, and a concurrent sweep could rmSync its DB dir
 *  out from under it (corruption/flake). Require BOTH staleness AND a dead owner: a live
 *  process's run dir is never reclaimed regardless of its mtime. */
export function isSweepable(dir: string, now: number = Date.now()): boolean {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(dir).mtimeMs;
  } catch {
    return false; // vanished between readdir and stat
  }
  if (now - mtimeMs <= STALE_MS) return false; // recently active — leave it
  return !ownerAlive(dir); // stale AND its creator is gone → safe to reclaim
}

for (const name of readdirSync(ROOT)) {
  const dir = path.join(ROOT, name);
  try {
    if (isSweepable(dir)) rmSync(dir, { recursive: true, force: true });
  } catch {
    /* in use or already gone — leave it for a later sweep */
  }
}

/** This process's throwaway DB directory (one SQLite file + WAL sidecars). */
export const UNIT_DB_DIR = mkdtempSync(path.join(ROOT, "run-"));

// Stamp the owning pid so a concurrent sweep can tell a LIVE run dir from an abandoned
// one — the fix for the write-only-activity blind spot above (data-store-persistence #5).
writeFileSync(path.join(UNIT_DB_DIR, "pid"), String(process.pid));

process.env.KP_DB_PATH = path.join(UNIT_DB_DIR, "kp.sqlite");

/** The isolated SQLite file every store in this process opens. */
export const UNIT_DB_PATH = process.env.KP_DB_PATH;

/** Close the memoized main connection (db/core caches it on globalThis) and
 *  best-effort remove the temp dir. Isolated-store handles have no close API;
 *  when one is open, Windows blocks the delete and the stale sweep above
 *  reclaims the dir on the next run instead. */
export function cleanupUnitDb(): void {
  const holder = globalThis as typeof globalThis & { __kpDb?: { close(): void } };
  try {
    holder.__kpDb?.close();
  } catch {
    /* already closed */
  }
  holder.__kpDb = undefined;
  try {
    rmSync(UNIT_DB_DIR, { recursive: true, force: true });
  } catch {
    /* an isolated store still holds the file — the next run's sweep gets it */
  }
}
