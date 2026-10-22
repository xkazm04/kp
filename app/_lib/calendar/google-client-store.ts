import { DEFAULT_WORKSPACE_ID } from "../db/workspaces";
import { publicBaseUrl } from "../public-base-url";
import { decryptCalendarSecret, encryptCalendarSecret } from "./calendar-secret";
import { googleOAuthConfig, type GoogleOAuthConfig, type StoredGoogleClient } from "./google-oauth";
import { calendarConnectionsDb } from "./token-store";

// T8 — the Google OAuth client an owner saves through Settings > Integrations, so the
// calendar no longer needs GOOGLE_OAUTH_CLIENT_ID/SECRET in env plus a restart.
//
// WHERE IT LIVES. On its own row of calendar_connections (`provider = 'google_client'`),
// not in a new table: the client belongs to the same workspace-scoped integration as the
// grant, so it inherits that table's tenancy scope, its workspace erasure and its export
// class without a second manifest entry. The grant's own queries all filter
// provider = 'google', so they never see this row, and a Disconnect (which deletes the
// grant row) keeps the client: reconnecting does not mean re-pasting it.
//
// SECRET DOCTRINE. The client secret is write-only over the API (getStoredGoogleClientStatus
// reports `hasSecret`, never the value) and sealed at rest under the calendar key
// (calendar-secret.ts). The plaintext exists only in memory while a token call is built.

const PROVIDER = "google_client";

export class GoogleClientInputError extends Error {
  readonly reason: "client_id_invalid" | "client_secret_invalid" | "client_secret_required";
  constructor(reason: GoogleClientInputError["reason"]) {
    super(reason);
    this.name = "GoogleClientInputError";
    this.reason = reason;
  }
}

/** No at-rest key could be made available, so nothing was sealed or stored. */
export class GoogleClientKeyError extends Error {
  constructor() {
    super("no calendar secret key available");
    this.name = "GoogleClientKeyError";
  }
}

type Row = { client_id: string | null; client_secret: string | null; connected_at: string | null };

function readRow(workspaceId: string): Row | undefined {
  return calendarConnectionsDb()
    .prepare(`SELECT client_id, client_secret, connected_at FROM calendar_connections WHERE workspace_id = ? AND provider = ?`)
    .get(workspaceId, PROVIDER) as Row | undefined;
}

// A Google client id is `<digits>-<random>.apps.googleusercontent.com`; the check is kept
// loose (no whitespace, sane length) so a format change at Google does not lock anyone out.
const CLEAN = /^\S+$/;
function cleanId(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v.length < 8 || v.length > 256 || !CLEAN.test(v)) throw new GoogleClientInputError("client_id_invalid");
  return v;
}

export type StoredGoogleClientStatus = {
  /** A client id was saved here. */
  saved: boolean;
  clientId: string | null;
  /** A secret is stored (sealed); its value is never returned. */
  hasSecret: boolean;
  /** The stored secret no longer opens under the current key (the key changed). */
  unreadable: boolean;
  savedAt: string | null;
};

/** Client-safe view of the saved client. Never carries the secret. */
export function getStoredGoogleClientStatus(workspaceId: string = DEFAULT_WORKSPACE_ID): StoredGoogleClientStatus {
  const row = readRow(workspaceId);
  if (!row?.client_id) return { saved: false, clientId: null, hasSecret: false, unreadable: false, savedAt: null };
  let unreadable = false;
  if (row.client_secret) {
    try {
      decryptCalendarSecret(row.client_secret);
    } catch {
      // Reported as a state, not thrown: the panel asks for the secret again.
      unreadable = true;
    }
  }
  return { saved: true, clientId: row.client_id, hasSecret: !!row.client_secret, unreadable, savedAt: row.connected_at };
}

/** Server-internal: the decrypted client, or null when none is saved or it no longer opens. */
export function getStoredGoogleClient(workspaceId: string = DEFAULT_WORKSPACE_ID): StoredGoogleClient | null {
  const row = readRow(workspaceId);
  if (!row?.client_id || !row.client_secret) return null;
  try {
    return { clientId: row.client_id, clientSecret: decryptCalendarSecret(row.client_secret) };
  } catch (err) {
    // The error names the key variables, never a value. Falls back to env (or "not configured").
    console.error(
      `[calendar] the saved Google OAuth client secret for workspace "${workspaceId}" could not be decrypted; has KP_CALENDAR_SECRET_KEY (or KP_SECRET) changed?`,
      err instanceof Error ? err.message : "unknown error"
    );
    return null;
  }
}

/**
 * Save (or replace) the workspace's OAuth client. A blank secret keeps the stored one, so
 * an owner can correct a client id without re-pasting a secret; a first save needs both.
 *
 * `ensureKey` runs AFTER the input is validated and before anything is sealed (the route
 * passes calendar-key.ts's ensureCalendarSecretKey), so a refused request never generates
 * or persists a key. It returns false when no key can be made available.
 */
export function saveGoogleClient(
  input: { clientId: unknown; clientSecret?: unknown },
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  ensureKey: () => boolean = () => true
): StoredGoogleClientStatus {
  const clientId = cleanId(input.clientId);
  const rawSecret = typeof input.clientSecret === "string" ? input.clientSecret.trim() : "";
  if (rawSecret && (rawSecret.length > 256 || !CLEAN.test(rawSecret))) throw new GoogleClientInputError("client_secret_invalid");
  const existing = readRow(workspaceId);
  if (!rawSecret && !existing?.client_secret) throw new GoogleClientInputError("client_secret_required");
  if (!ensureKey()) throw new GoogleClientKeyError();
  let sealed: string;
  if (rawSecret) {
    sealed = encryptCalendarSecret(rawSecret);
  } else if (existing?.client_secret && getStoredGoogleClient(workspaceId)) {
    sealed = existing.client_secret;
  } else {
    throw new GoogleClientInputError("client_secret_required");
  }
  calendarConnectionsDb()
    .prepare(
      `INSERT INTO calendar_connections (workspace_id, provider, client_id, client_secret, connected_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, provider) DO UPDATE SET
         client_id = excluded.client_id, client_secret = excluded.client_secret, connected_at = excluded.connected_at`
    )
    .run(workspaceId, PROVIDER, clientId, sealed, new Date().toISOString());
  return getStoredGoogleClientStatus(workspaceId);
}

/** The client a workspace's calendar calls use: the saved one first, then the env pair. */
export function googleOAuthConfigFor(
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  baseUrl: string = publicBaseUrl(null),
  env: NodeJS.ProcessEnv = process.env
): GoogleOAuthConfig | null {
  return googleOAuthConfig(baseUrl, env, getStoredGoogleClient(workspaceId));
}
