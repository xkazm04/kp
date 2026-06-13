import Database from "better-sqlite3";
import { DB_PATH, ensureDbDir } from "./db-path";
import { randomToken } from "./random-id";

// Candidate application-status links (idea-e76a6fb2). Isolated-connection store
// (same pattern as offers-store.ts / schedule-store.ts): owns the
// `application_status_links` table mapping an unguessable public token → a
// pipeline entry. The entry's PRIMARY KEY is deliberately NEVER exposed to the
// candidate (it's an IDOR handle other entry-keyed flows accept); this token is
// the only public handle, so a candidate can check their own status without
// authenticating and without anyone being able to enumerate others'.

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  ensureDbDir();
  const d = new Database(DB_PATH);
  d.pragma("journal_mode = WAL");
  // Mints interleave with the apply POST's other writers on the same kp.sqlite
  // file — wait briefly rather than throwing SQLITE_BUSY (mirrors the sibling stores).
  d.pragma("busy_timeout = 5000");
  d.exec(`
    CREATE TABLE IF NOT EXISTS application_status_links (
      token TEXT PRIMARY KEY,
      -- UNIQUE so a re-apply (which reuses the ORIGINAL entry, never a new row)
      -- returns the SAME status link instead of accreting a second one.
      entry_id TEXT UNIQUE,
      created_at TEXT NOT NULL
    );
  `);
  _db = d;
  return d;
}

/** Get the candidate's status-link token for an entry, minting one on first ask.
 *  IMMEDIATE transaction so two concurrent mints for the same entry can't both
 *  insert (the UNIQUE entry_id backstops it regardless); the existing token wins. */
export function getOrCreateStatusLink(entryId: string): string {
  const d = db();
  const tx = d.transaction((): string => {
    const existing = d.prepare(`SELECT token FROM application_status_links WHERE entry_id = ?`).get(entryId) as
      | { token: string }
      | undefined;
    if (existing) return existing.token;
    const token = randomToken("as");
    d.prepare(`INSERT INTO application_status_links (token, entry_id, created_at) VALUES (?, ?, ?)`).run(
      token,
      entryId,
      new Date().toISOString()
    );
    return token;
  });
  return tx.immediate();
}

/** Resolve a status-link token to its pipeline entry id, or null for an unknown
 *  token (a guessed/expired link). */
export function getEntryIdByStatusToken(token: string): string | null {
  const r = db().prepare(`SELECT entry_id FROM application_status_links WHERE token = ?`).get(token) as
    | { entry_id: string }
    | undefined;
  return r?.entry_id ?? null;
}
