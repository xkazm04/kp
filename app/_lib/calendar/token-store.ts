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
  /** Whether the grant still WORKS, as last observed — see CALENDAR_GRANT_HEALTH. */
  health: CalendarGrantHealth;
  /** When the grant was last seen to stop working; null while it is healthy. */
  healthAt: string | null;
};

/**
 * Whether the stored grant still works, as the calendar edge last OBSERVED it.
 *
 * `connected` (a refresh token is stored) cannot say this: Google revokes a grant on its
 * side (the user withdrew access, changed their password, an admin policy, a testing-mode
 * client's 7-day expiry) and our row does not change. Without a recorded health a dead
 * grant read as connected forever and every failure surfaced as the transient
 * "the lookup failed", which asks the recruiter to wait for a problem only a reconnect fixes.
 *   ok             — nothing has told us otherwise.
 *   revoked        — Google answered a refresh with `invalid_grant`. Permanent: only a
 *                    fresh consent recovers, so the edge stops calling Google at all.
 *   undecryptable  — the stored token no longer decrypts (the at-rest key changed). Local
 *                    and cheap to re-check, so it heals by itself if the key comes back.
 * Timeouts, 5xx and throttling NEVER set this — they are the transient kind.
 */
export const CALENDAR_GRANT_HEALTH = ["ok", "revoked", "undecryptable"] as const;
export type CalendarGrantHealth = (typeof CALENDAR_GRANT_HEALTH)[number];

const asHealth = (v: string | null): CalendarGrantHealth =>
  (CALENDAR_GRANT_HEALTH as readonly string[]).includes(v ?? "") ? (v as CalendarGrantHealth) : "ok";

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
  // Grant health (see CALENDAR_GRANT_HEALTH), added to a table that predates it. Isolated
  // store, so no core.ts migrator: add each column here, tolerating "duplicate column" on
  // every boot after the first. NULL health on a legacy row reads as 'ok' — today's meaning.
  for (const col of ["health TEXT", "health_at TEXT"]) {
    try {
      d.exec(`ALTER TABLE calendar_connections ADD COLUMN ${col}`);
    } catch {
      /* column already exists — idempotent */
    }
  }
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
  health: string | null;
  health_at: string | null;
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
    health: asHealth(row.health),
    healthAt: row.health_at,
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
 *
 * A completed authorization is the ONE thing that proves a grant works again, so it
 * resets health to 'ok' — this is the Reconnect button's whole effect on a revoked grant.
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
         (workspace_id, provider, account_email, calendar_id, refresh_token, access_token, access_expires_at, scopes_json, missing_scopes_json, connected_at, health, health_at)
       VALUES (?, 'google', ?, ?, ?, ?, ?, ?, ?, ?, 'ok', NULL)
       ON CONFLICT(workspace_id, provider) DO UPDATE SET
         account_email = excluded.account_email, calendar_id = excluded.calendar_id,
         refresh_token = excluded.refresh_token, access_token = excluded.access_token,
         access_expires_at = excluded.access_expires_at, scopes_json = excluded.scopes_json,
         missing_scopes_json = excluded.missing_scopes_json, connected_at = excluded.connected_at,
         health = 'ok', health_at = NULL`
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

/** Record what the calendar edge observed about the grant. Only a CHANGE is written, and
 *  health_at keeps the moment it first went bad (a revoked grant stays revoked "since
 *  Tuesday", not "since the last page load"); 'ok' clears it. No-op without a row. */
export function markCalendarHealth(health: CalendarGrantHealth, workspaceId: string = DEFAULT_WORKSPACE_ID): void {
  db()
    .prepare(
      `UPDATE calendar_connections
          SET health = ?, health_at = ?
        WHERE workspace_id = ? AND provider = 'google' AND COALESCE(health, 'ok') != ?`
    )
    .run(health, health === "ok" ? null : new Date().toISOString(), workspaceId, health);
}

/** Forget the connection entirely. The caller revokes at Google FIRST — deleting our row
 *  without revoking would leave a live grant nobody can see or withdraw from kp. */
export function deleteCalendarConnection(workspaceId: string = DEFAULT_WORKSPACE_ID): boolean {
  return (
    db().prepare(`DELETE FROM calendar_connections WHERE workspace_id = ? AND provider = 'google'`).run(workspaceId).changes > 0
  );
}
