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
// stores (offers, scheduler, onboarding, …) hold private handles with no close
// API, and Windows refuses to delete a file another handle keeps open — so each
// run ALSO sweeps stale dirs left by previous runs (mtime-gated so concurrently
// running test files can't sweep each other).

import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
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
]) {
  delete process.env[key];
}

const ROOT = path.join(tmpdir(), "kp-unit-db");
mkdirSync(ROOT, { recursive: true });

// Sweep leftovers from PREVIOUS runs. Only dirs untouched for >15 minutes are
// removed: a sibling test file running right now has a fresh mtime, and on POSIX
// an unguarded rm would happily unlink its open SQLite file mid-test.
const STALE_MS = 15 * 60 * 1000;
for (const name of readdirSync(ROOT)) {
  const dir = path.join(ROOT, name);
  try {
    if (Date.now() - statSync(dir).mtimeMs > STALE_MS) rmSync(dir, { recursive: true, force: true });
  } catch {
    /* in use or already gone — leave it for a later sweep */
  }
}

/** This process's throwaway DB directory (one SQLite file + WAL sidecars). */
export const UNIT_DB_DIR = mkdtempSync(path.join(ROOT, "run-"));

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
