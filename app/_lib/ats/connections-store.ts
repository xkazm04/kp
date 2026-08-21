import Database from "better-sqlite3";
import { openStore } from "../db-path";
import { assertPublicHttpsEndpoint } from "../safe-url";
import { decryptAtsSecret, encryptAtsSecret, isEncryptedAtsSecret } from "../ats-secret";
import { parseFieldMap, type AtsFieldMap } from "./field-map";

// W1.1 — per-connection ATS credentials + field map.
//
// The egress side already had a config store (ats-config-store.ts: one row, one webhook
// URL, one signing secret). Ingest cannot reuse it: a customer can plausibly connect more
// than one ATS, each with its own token, base URL and field map — so this is keyed by
// provider rather than pinned to a single row.
//
// It inherits ats-config-store's two hard-won rules verbatim, because both exist for
// reasons that apply at least as strongly here:
//
//   SECRET DOCTRINE — the API token is WRITE-ONLY over the API. getAtsConnection() returns
//   `hasToken`, never the token; getAtsToken() is the server-internal reader a connector
//   uses. An ATS token reads every candidate in the customer's account, so leaking it
//   through a config GET would be worse than leaking our own webhook secret.
//
//   AT REST — encrypted (AES-256-GCM, ats-secret.ts). The whole-DB export dumps every
//   column, so a plaintext token would ship in the customer's own backup. We refuse to
//   store a token at all rather than fall back to plaintext when no key is configured.
//
// Own isolated connection on the shared kp.sqlite, same as its egress sibling.

export type AtsConnectionPublic = {
  provider: string;
  baseUrl: string | null;
  hasToken: boolean;
  fieldMap: AtsFieldMap;
  /** false parks a connection without deleting its credentials or its links. */
  enabled: boolean;
  updatedAt: string | null;
};

export class AtsConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AtsConnectionError";
  }
}

// Providers we have (or are building) a hand-built connector for. An allowlist rather than
// free text: `provider` namespaces every external id in ats_links, so a typo would silently
// create a parallel id namespace and re-import the whole pipeline under it.
export const ATS_PROVIDERS = ["recruitee", "recruitis", "teamio"] as const;
export type AtsProvider = (typeof ATS_PROVIDERS)[number];

export function isAtsProvider(v: unknown): v is AtsProvider {
  return typeof v === "string" && (ATS_PROVIDERS as readonly string[]).includes(v);
}

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  const d = openStore();
  d.exec(`
    CREATE TABLE IF NOT EXISTS ats_connections (
      provider TEXT PRIMARY KEY,
      base_url TEXT,
      api_token TEXT,
      field_map_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT
    );
  `);
  _db = d;
  return d;
}

type Row = {
  provider: string;
  base_url: string | null;
  api_token: string | null;
  field_map_json: string;
  enabled: number;
  updated_at: string | null;
};

/** A stored map that fails validation reads as an EMPTY map rather than throwing, so one
 *  corrupt row cannot break the connections list — but an empty map has no externalId
 *  path, so a sync using it fails loudly instead of importing under a bad identity. */
function safeFieldMap(json: string, provider: string): AtsFieldMap {
  try {
    return parseFieldMap(JSON.parse(json));
  } catch {
    console.error(`[ats] connection "${provider}" has an unusable field map — treating it as unset`);
    return { paths: {}, stages: {} };
  }
}

function toPublic(row: Row): AtsConnectionPublic {
  return {
    provider: row.provider,
    baseUrl: row.base_url,
    hasToken: !!row.api_token,
    fieldMap: safeFieldMap(row.field_map_json, row.provider),
    enabled: row.enabled !== 0,
    updatedAt: row.updated_at,
  };
}

export function listAtsConnections(): AtsConnectionPublic[] {
  return (db().prepare(`SELECT * FROM ats_connections ORDER BY provider ASC`).all() as Row[]).map(toPublic);
}

/** Client-safe view — never carries the token. */
export function getAtsConnection(provider: string): AtsConnectionPublic | null {
  const row = db().prepare(`SELECT * FROM ats_connections WHERE provider = ?`).get(provider) as Row | undefined;
  return row ? toPublic(row) : null;
}

/** Server-internal: the DECRYPTED token, or null. Never goes over the API. A legacy
 *  plaintext value is returned as-is (and re-encrypted on the next write) so an existing
 *  connection keeps working; a ciphertext that cannot be decrypted throws, which the
 *  connector surfaces as a sync failure rather than an empty result set. */
export function getAtsToken(provider: string): string | null {
  const row = db().prepare(`SELECT api_token FROM ats_connections WHERE provider = ?`).get(provider) as
    | { api_token: string | null }
    | undefined;
  const stored = row?.api_token ?? null;
  if (stored === null) return null;
  return isEncryptedAtsSecret(stored) ? decryptAtsSecret(stored) : stored;
}

function validateBaseUrl(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string") throw new AtsConnectionError("baseUrl must be a string or empty.");
  // Same SSRF boundary as the outbound webhook: the server will send an authenticated
  // request here, so https-only and no IP literals / internal hostnames. A token pointed
  // at 169.254.169.254 would hand our credentials to a metadata service.
  try {
    return assertPublicHttpsEndpoint(raw, "baseUrl");
  } catch (e) {
    throw new AtsConnectionError(e instanceof Error ? e.message : "baseUrl is not an allowed URL.");
  }
}

/**
 * Upsert one connection. Every field is a PARTIAL update — an omitted key keeps what is
 * stored, and only an explicit value changes it:
 *   • `apiToken` omitted    → keep the stored (already-encrypted) value.
 *   • `apiToken` === ""     → CLEAR it (the connection is parked, not deleted).
 *   • any other string      → replace it.
 *   • `baseUrl` omitted     → keep the stored URL. `null` / `""` CLEARS it (the panel
 *                             sends an explicit null for a blanked field, so blanking
 *                             still works); any other string is re-validated and replaces.
 *   • `fieldMap` / `enabled` omitted → keep, same as above.
 *
 * baseUrl used to be the one field written unconditionally, so the documented park
 * (`{ provider, enabled: false }`) and any other partial write silently NULLed the
 * endpoint — leaving a connection with a live token and a field map but nothing to call.
 * A preserved URL is not re-validated: like the stored token it was vetted when written,
 * and a connector re-vets before it fetches (the same stance ats-config-store takes for a
 * URL stored before a rule tightened).
 */
export function setAtsConnection(input: {
  provider: unknown;
  baseUrl?: unknown;
  apiToken?: unknown;
  fieldMap?: unknown;
  enabled?: unknown;
}): AtsConnectionPublic {
  if (!isAtsProvider(input.provider)) {
    throw new AtsConnectionError(`unknown provider. Allowed: ${ATS_PROVIDERS.join(", ")}.`);
  }
  const provider = input.provider;
  const existing = db().prepare(`SELECT * FROM ats_connections WHERE provider = ?`).get(provider) as Row | undefined;

  const baseUrl = input.baseUrl === undefined ? (existing?.base_url ?? null) : validateBaseUrl(input.baseUrl);

  let fieldMapJson = existing?.field_map_json ?? "{}";
  if (input.fieldMap !== undefined) {
    // parseFieldMap throws AtsFieldMapError, which the route maps to 400 — a map without
    // an externalId path must never reach storage.
    fieldMapJson = JSON.stringify(parseFieldMap(input.fieldMap));
  }

  let storedToken: string | null = existing?.api_token ?? null;
  if (input.apiToken !== undefined) {
    if (typeof input.apiToken !== "string") throw new AtsConnectionError("apiToken must be a string.");
    if (input.apiToken === "") {
      storedToken = null;
    } else {
      try {
        storedToken = encryptAtsSecret(input.apiToken);
      } catch (e) {
        throw new AtsConnectionError(e instanceof Error ? e.message : "Cannot store the ATS API token.");
      }
    }
  }

  const enabled = input.enabled === undefined ? (existing?.enabled ?? 1) : input.enabled ? 1 : 0;
  db()
    .prepare(
      `INSERT INTO ats_connections (provider, base_url, api_token, field_map_json, enabled, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET base_url = excluded.base_url, api_token = excluded.api_token,
         field_map_json = excluded.field_map_json, enabled = excluded.enabled, updated_at = excluded.updated_at`
    )
    .run(provider, baseUrl, storedToken, fieldMapJson, enabled, new Date().toISOString());
  return getAtsConnection(provider)!;
}

/** Remove a connection. Its ats_links are NOT dropped here — see deleteAtsLinksForProvider,
 *  which the caller invokes deliberately: forgetting the links means a re-connect re-imports
 *  every candidate as new, so that is a decision, not a side effect of deleting a token. */
export function deleteAtsConnection(provider: string): boolean {
  return db().prepare(`DELETE FROM ats_connections WHERE provider = ?`).run(provider).changes > 0;
}
