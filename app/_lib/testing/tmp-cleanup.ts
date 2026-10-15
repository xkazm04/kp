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

import { rmSync } from "node:fs";
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

/** Close tracked database handles, then remove each folder. Unlike a bare rmSync this is
 *  loud: a folder that survives the retries throws instead of leaking in silence. */
export function removeTempDirs(...dirs: string[]): void {
  closeTrackedDatabases();
  if (process.env.KP_KEEP_TMP === "1") return;
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
