import Database from "better-sqlite3";
import { openStore } from "./db-path";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
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
  // Isolated connection on the shared kp.sqlite file (WAL + busy_timeout=5000):
  // mints interleave with the apply POST's other writers on the same file — wait
  // briefly rather than throwing SQLITE_BUSY (mirrors the sibling stores).
  const d = openStore();
  d.exec(`
    CREATE TABLE IF NOT EXISTS application_status_links (
      token TEXT PRIMARY KEY,
      -- UNIQUE so a re-apply (which reuses the ORIGINAL entry, never a new row)
      -- returns the SAME status link instead of accreting a second one.
      entry_id TEXT UNIQUE,
      created_at TEXT NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT 'workspace'
    );
  `);
  // Tenancy scoping (E0 Phase 1): workspace_id on a pre-existing table (isolated store).
  try {
    d.exec(`ALTER TABLE application_status_links ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'workspace'`);
  } catch {
    /* column already exists — idempotent */
  }
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
    // Tenant (P1): the link inherits its entry's workspace (by-id read; guarded so an
    // isolated store without pipeline_entries falls back to default). Both reads are by
    // the unguessable token / globally-unique entry_id, so the stamp is future-proofing.
    let workspaceId = DEFAULT_WORKSPACE_ID;
    try {
      const ws = d.prepare(`SELECT workspace_id FROM pipeline_entries WHERE id = ?`).get(entryId) as { workspace_id?: string } | undefined;
      workspaceId = ws?.workspace_id ?? DEFAULT_WORKSPACE_ID;
    } catch {
      /* pipeline_entries absent on this connection — keep the default workspace */
    }
    d.prepare(`INSERT INTO application_status_links (token, entry_id, created_at, workspace_id) VALUES (?, ?, ?, ?)`).run(
      token,
      entryId,
      new Date().toISOString(),
      workspaceId
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
