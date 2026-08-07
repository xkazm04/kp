import Database from "better-sqlite3";
import { openStore } from "../db-path";
import { decryptAtsSecret, encryptAtsSecret, isEncryptedAtsSecret } from "../ats-secret";
import { DEFAULT_WORKSPACE_ID } from "../db/workspaces";
import type { GoogleTokens } from "./google-oauth";

// W1.4 — the connected Google calendar per workspace.
//
// SECRET DOCTRINE, third application (llm-secret → ats connections → here). The refresh
// token is the most durable credential kp holds: it does not expire, and it grants ongoing
// access to a person's calendar. So it is write-only over the API (getCalendarConnection
// reports `connected`, never the token) and encrypted at rest, because the whole-DB export
// dumps every column and a plaintext refresh token in a customer's backup is a standing
// compromise of an employee's private calendar.
//
// ONE CONNECTION PER WORKSPACE, not per recruiter. A team schedules against a shared
// hiring calendar, and per-recruiter connections would need every interviewer to authorize
// before the feature did anything. Per-recruiter is the natural next step (the row is
// already keyed by workspace + account email, so adding a user dimension is additive).

export type CalendarConnection = {
  workspaceId: string;
  provider: "google";
  /** Which Google account is connected — shown so an operator can tell whose calendar
   *  this is without exposing anything else about it. */
  accountEmail: string | null;
  /** The calendar whose free/busy we consult. "primary" unless overridden. */
  calendarId: string;
  scopes: string[];
  connected: boolean;
  connectedAt: string | null;
  /** Present so the UI can warn about a partial grant rather than failing silently later. */
  missingScopes: string[];
};

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  const d = openStore();
  d.exec(`
    CREATE TABLE IF NOT EXISTS calendar_connections (
      workspace_id TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'google',
      account_email TEXT,
      calendar_id TEXT NOT NULL DEFAULT 'primary',
      refresh_token TEXT,
      access_token TEXT,
      access_expires_at TEXT,
      scopes_json TEXT NOT NULL DEFAULT '[]',
      missing_scopes_json TEXT NOT NULL DEFAULT '[]',
      connected_at TEXT,
      PRIMARY KEY (workspace_id, provider)
    );
  `);
  _db = d;
  return d;
}

type Row = {
  workspace_id: string;
  provider: string;
  account_email: string | null;
  calendar_id: string;
  refresh_token: string | null;
  access_token: string | null;
  access_expires_at: string | null;
  scopes_json: string;
  missing_scopes_json: string;
  connected_at: string | null;
};

const parseList = (json: string): string[] => {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

function readRow(workspaceId: string): Row | undefined {
  return db()
    .prepare(`SELECT * FROM calendar_connections WHERE workspace_id = ? AND provider = 'google'`)
    .get(workspaceId) as Row | undefined;
}

/** Client-safe view. Never carries a token. */
export function getCalendarConnection(workspaceId: string = DEFAULT_WORKSPACE_ID): CalendarConnection | null {
  const row = readRow(workspaceId);
  if (!row) return null;
  return {
    workspaceId: row.workspace_id,
    provider: "google",
    accountEmail: row.account_email,
    calendarId: row.calendar_id,
    scopes: parseList(row.scopes_json),
    // Connected means we can still act on our own: an access token alone expires within
    // the hour, so without a refresh token this integration is already dead.
    connected: !!row.refresh_token,
    connectedAt: row.connected_at,
    missingScopes: parseList(row.missing_scopes_json),
  };
}

const decryptOrNull = (stored: string | null): string | null => {
  if (stored === null) return null;
  return isEncryptedAtsSecret(stored) ? decryptAtsSecret(stored) : stored;
};

/** Server-internal: the DECRYPTED refresh token. Never crosses the API boundary. */
export function getRefreshToken(workspaceId: string = DEFAULT_WORKSPACE_ID): string | null {
  return decryptOrNull(readRow(workspaceId)?.refresh_token ?? null);
}

/** Server-internal: the cached access token and its expiry, so a burst of free/busy
 *  queries does not mint a new one per call. */
export function getCachedAccessToken(workspaceId: string = DEFAULT_WORKSPACE_ID): { token: string; expiresAt: string | null } | null {
  const row = readRow(workspaceId);
  const token = decryptOrNull(row?.access_token ?? null);
  return token ? { token, expiresAt: row?.access_expires_at ?? null } : null;
}

/**
 * Store a completed authorization.
 *
 * A refresh-token-less response does NOT clear the stored one: Google omits it on a
 * re-grant, and wiping ours on a re-auth would break the connection that just succeeded.
 */
export function saveCalendarConnection(
  input: { tokens: GoogleTokens; accountEmail?: string | null; calendarId?: string; missingScopes?: string[] },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): CalendarConnection {
  const existing = readRow(workspaceId);
  const refresh = input.tokens.refreshToken ? encryptAtsSecret(input.tokens.refreshToken) : existing?.refresh_token ?? null;
  db()
    .prepare(
      `INSERT INTO calendar_connections
         (workspace_id, provider, account_email, calendar_id, refresh_token, access_token, access_expires_at, scopes_json, missing_scopes_json, connected_at)
       VALUES (?, 'google', ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, provider) DO UPDATE SET
         account_email = excluded.account_email, calendar_id = excluded.calendar_id,
         refresh_token = excluded.refresh_token, access_token = excluded.access_token,
         access_expires_at = excluded.access_expires_at, scopes_json = excluded.scopes_json,
         missing_scopes_json = excluded.missing_scopes_json, connected_at = excluded.connected_at`
    )
    .run(
      workspaceId,
      input.accountEmail ?? existing?.account_email ?? null,
      input.calendarId ?? existing?.calendar_id ?? "primary",
      refresh,
      encryptAtsSecret(input.tokens.accessToken),
      input.tokens.expiresAt,
      JSON.stringify(input.tokens.scopes),
      JSON.stringify(input.missingScopes ?? []),
      existing?.connected_at ?? new Date().toISOString()
    );
  return getCalendarConnection(workspaceId)!;
}

/** Refresh just the access token, leaving the grant intact. */
export function updateAccessToken(tokens: GoogleTokens, workspaceId: string = DEFAULT_WORKSPACE_ID): void {
  db()
    .prepare(
      `UPDATE calendar_connections SET access_token = ?, access_expires_at = ?
       WHERE workspace_id = ? AND provider = 'google'`
    )
    .run(encryptAtsSecret(tokens.accessToken), tokens.expiresAt, workspaceId);
}

/** Forget the connection entirely. The caller revokes at Google FIRST — deleting our row
 *  without revoking would leave a live grant nobody can see or withdraw from kp. */
export function deleteCalendarConnection(workspaceId: string = DEFAULT_WORKSPACE_ID): boolean {
  return (
    db().prepare(`DELETE FROM calendar_connections WHERE workspace_id = ? AND provider = 'google'`).run(workspaceId).changes > 0
  );
}
