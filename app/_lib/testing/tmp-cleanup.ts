// Temp-dir cleanup for tests and scripts that create their own `os.tmpdir()` folders.
//
// Why this exists: `fs.rmSync(dir)` cannot delete a folder while a SQLite handle inside it is
// open (Windows: EPERM/EBUSY), and the isolated-connection stores (db-path.ts openStore) keep
// private handles with no close API. Callers used to swallow that error, so every run left a
// `kp-*` folder behind (about 100k entries measured 2026-10-15).
//
// Importing this module installs a tracker on better-sqlite3: every handle that goes through
// openStore() runs `pragma`, which records the handle. `removeTempDirs()` closes every tracked
// handle first, then removes the folders. Import it BEFORE any module that opens a database.
// Set KP_KEEP_TMP=1 to keep the folders for debugging.

import { appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

type Handle = { close(): unknown; open: boolean };
const opened = new Set<Handle>();

const proto = Database.prototype as unknown as { pragma: (...args: unknown[]) => unknown };
const original = proto.pragma;
if (!(original as { __kpTracked?: boolean }).__kpTracked) {
  const tracked = function (this: Handle, ...args: unknown[]) {
    opened.add(this);
    return original.apply(this, args);
  };
  (tracked as unknown as { __kpTracked: boolean }).__kpTracked = true;
  proto.pragma = tracked;
}

/** Close every SQLite handle opened in this process (and the memoized main connection). */
export function closeTrackedDatabases(): void {
  const holder = globalThis as typeof globalThis & { __kpDb?: Handle };
  if (holder.__kpDb) opened.add(holder.__kpDb);
  for (const h of opened) {
    try {
      if (h.open) h.close();
    } catch {
      /* already closed */
    }
  }
  opened.clear();
  holder.__kpDb = undefined;
}

type Remove = (dir: string) => void;
const removeWithRetries: Remove = (dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

/** Where a leaked folder is recorded (one JSON line each). KP_TMP_LEAK_LOG moves it. */
export function tmpLeakLogPath(): string {
  return process.env.KP_TMP_LEAK_LOG || path.join(tmpdir(), "kp-tmp-leaks.log");
}

/** Close tracked database handles, then remove each folder. Unlike a bare rmSync this is
 *  loud: a folder that survives the retries throws instead of leaking in silence. For scripts
 *  and any caller where a leak must stop the run; test `after()` hooks use removeTempDirsInHook. */
export function removeTempDirs(...dirs: string[]): void {
  closeTrackedDatabases();
  if (process.env.KP_KEEP_TMP === "1") return;
  for (const dir of dirs) removeWithRetries(dir);
}

/** The `after()` hook form (ADR 0031): a leak is still a defect, but the hook runs after the
 *  file's own tests have passed, so a busy folder must not fail them. Logs and records each
 *  leaked path (never throws) and returns the leaked paths. `remove` is the test seam. */
export function removeTempDirsInHook(dirs: string[], remove: Remove = removeWithRetries): string[] {
  closeTrackedDatabases();
  if (process.env.KP_KEEP_TMP === "1") return [];
  const leaked: string[] = [];
  for (const dir of dirs) {
    try {
      remove(dir);
    } catch (err) {
      leaked.push(dir);
      const code = (err as NodeJS.ErrnoException)?.code ?? "UNKNOWN";
      console.warn(`[tmp-cleanup] leaked ${dir} (${code}); recorded in ${tmpLeakLogPath()}`);
      try {
        appendFileSync(tmpLeakLogPath(), JSON.stringify({ at: new Date().toISOString(), dir, code }) + "\n");
      } catch {
        /* best-effort: the warning above already names the path; the record is a convenience */
      }
    }
  }
  return leaked;
}
