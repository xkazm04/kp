import Database from "better-sqlite3";
import { openStore } from "../db-path";
import { assertPublicHttpsEndpoint } from "../safe-url";
import { decryptAtsSecret, encryptAtsSecret, isEncryptedAtsSecret, reencryptAtsSecret } from "../ats-secret";
import type { RefusalErrorCode } from "../api-response";
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
  /** Bumped on every accepted write. The panel echoes the version it READ back as
   *  `expectedVersion`, and the store re-asserts it inside the write lock — the same
   *  optimistic-concurrency contract ats-config-store has carried since
   *  /perfect 2026-09-03. Without it two operator tabs were last-write-wins: a save
   *  that only meant to park a connection silently reverted the base URL and field map
   *  the other tab had just written. */
  version: number;
  updatedAt: string | null;
};

export class AtsConnectionError extends Error {
  /** The refusal the route answers with. The English `.message` stays operator detail
   *  for the server log; the panel renders `errors.<code>` in the reader's language
   *  (.claude/CLAUDE.md, "a failure is answered with a CODE"). */
  readonly code: RefusalErrorCode;
  constructor(message: string, code: RefusalErrorCode) {
    super(message);
    this.name = "AtsConnectionError";
    this.code = code;
  }
}

/** A write composed against a connection someone else has since replaced. A REFUSAL
 *  (409, nothing written), not a validation failure — subclassed so the route can answer
 *  it before the 400 branch, exactly as its egress sibling does with AtsConfigStaleError. */
export class AtsConnectionStaleError extends AtsConnectionError {
  constructor(message: string) {
    super(message, "ATS_CONNECTION_STALE");
    this.name = "AtsConnectionStaleError";
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
      version INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT
    );
  `);
  // Connections stored before optimistic concurrency existed have no `version` column.
  // ADD COLUMN with a DEFAULT backfills every existing row to 0 — exactly the version a
  // panel that has just read one sends, so the first write after an upgrade is not
  // spuriously refused. (Same additive migration as ats-config-store.ts.)
  try {
    d.exec(`ALTER TABLE ats_connections ADD COLUMN version INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Already present (the CREATE TABLE above just made it, or an earlier boot did) —
    // the only expected failure here, and re-adding is the no-op we want.
  }
  _db = d;
  return d;
}

type Row = {
  provider: string;
  base_url: string | null;
  api_token: string | null;
  field_map_json: string;
  enabled: number;
  version: number | null;
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
    version: row.version ?? 0,
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
  if (typeof raw !== "string") {
    throw new AtsConnectionError("baseUrl must be a string or empty.", "ATS_CONNECTION_BASE_URL_INVALID");
  }
  // Same SSRF boundary as the outbound webhook: the server will send an authenticated
  // request here, so https-only and no IP literals / internal hostnames. A token pointed
  // at 169.254.169.254 would hand our credentials to a metadata service.
  try {
    return assertPublicHttpsEndpoint(raw, "baseUrl");
  } catch (e) {
    throw new AtsConnectionError(
      e instanceof Error ? e.message : "baseUrl is not an allowed URL.",
      "ATS_CONNECTION_BASE_URL_INVALID"
    );
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
 *
 * `expectedVersion`, when given, is the version the caller READ (GET's
 * `connection.version`). The read→compute→write runs in an IMMEDIATE transaction and
 * re-asserts it INSIDE the write lock, so a save composed against a connection someone
 * else has since replaced is DROPPED (AtsConnectionStaleError → a 409 the panel offers a
 * reload for) rather than applied on top of theirs. Omit it only for server-internal
 * writes with no read to be stale about (tests, fixtures) — see ats-config-store.ts, the
 * same doctrine, and comms-relay-store.ts before it.
 *
 * Validation throws AtsConnectionError (or AtsFieldMapError), each carrying the refusal
 * `code` the route answers with — never a prose message the panel would render as-is.
 */
export function setAtsConnection(input: {
  provider: unknown;
  baseUrl?: unknown;
  apiToken?: unknown;
  fieldMap?: unknown;
  enabled?: unknown;
  expectedVersion?: unknown;
}): AtsConnectionPublic {
  if (!isAtsProvider(input.provider)) {
    throw new AtsConnectionError(
      `unknown provider. Allowed: ${ATS_PROVIDERS.join(", ")}.`,
      "ATS_CONNECTION_PROVIDER_UNKNOWN"
    );
  }
  const provider = input.provider;

  // Validation and encryption are pure and can throw — they run OUTSIDE the write lock so
  // a bad URL, an unusable field map or a missing at-rest key never opens a transaction.
  // `undefined` means "keep what is stored"; the transaction below resolves that against
  // the row it reads under the lock.
  const baseUrl = input.baseUrl === undefined ? undefined : validateBaseUrl(input.baseUrl);
  // parseFieldMap throws AtsFieldMapError, which the route maps to ATS_FIELD_MAP_INVALID —
  // a map without an externalId path must never reach storage.
  const fieldMapJson = input.fieldMap === undefined ? undefined : JSON.stringify(parseFieldMap(input.fieldMap));

  let nextToken: string | null | undefined;
  if (input.apiToken !== undefined) {
    if (typeof input.apiToken !== "string") {
      throw new AtsConnectionError("apiToken must be a string.", "ATS_CONNECTION_TOKEN_INVALID");
    }
    if (input.apiToken === "") {
      nextToken = null;
    } else {
      try {
        nextToken = encryptAtsSecret(input.apiToken);
      } catch (e) {
        throw new AtsConnectionError(
          e instanceof Error ? e.message : "Cannot store the ATS API token.",
          "ATS_CONNECTION_TOKEN_INVALID"
        );
      }
    }
  }

  let expected: number | undefined;
  if (input.expectedVersion !== undefined && input.expectedVersion !== null) {
    const n = Number(input.expectedVersion);
    // A version we cannot compare is not a version we can honour, and the honest advice is
    // the same as a genuine mismatch: reload and re-apply. So it refuses as STALE rather
    // than inventing a shape-validation sentence for a value only our own panel sends.
    if (!Number.isInteger(n) || n < 0) {
      throw new AtsConnectionStaleError("expectedVersion must be a whole number.");
    }
    expected = n;
  }

  // IMMEDIATE: the write lock is taken at BEGIN, so the version this reads cannot move
  // between the check and the UPDATE (.claude/CLAUDE.md, "a read→compute→write either
  // locks or re-checks"). Nothing here awaits — every slow/throwing step ran above.
  const write = db().transaction((): void => {
    const existing = db().prepare(`SELECT * FROM ats_connections WHERE provider = ?`).get(provider) as Row | undefined;
    const version = existing?.version ?? 0;
    if (expected !== undefined && expected !== version) {
      throw new AtsConnectionStaleError("The ATS connection changed since it was read. Reload and make your change again.");
    }
    // A preserved token is re-encrypted under the CURRENT at-rest key when it is still
    // sealed under KP_SECRET_PREVIOUS, so a rotated deployment heals itself on the next
    // save instead of waiting for `npm run secrets:rotate`. Best-effort by design: a value
    // neither key opens is left exactly as stored — rewriting a row we cannot read would
    // destroy the only copy of the customer's credential.
    let storedToken = existing?.api_token ?? null;
    if (nextToken !== undefined) {
      storedToken = nextToken;
    } else if (storedToken !== null && isEncryptedAtsSecret(storedToken)) {
      try {
        storedToken = reencryptAtsSecret(storedToken).ciphertext;
      } catch {
        // Undecryptable under both keys: keep the ciphertext untouched. Loud on READ
        // (getAtsToken throws, which the connector surfaces as a sync failure) rather
        // than here, where the operator is editing an unrelated field.
      }
    }
    db()
      .prepare(
        `INSERT INTO ats_connections (provider, base_url, api_token, field_map_json, enabled, version, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider) DO UPDATE SET base_url = excluded.base_url, api_token = excluded.api_token,
           field_map_json = excluded.field_map_json, enabled = excluded.enabled, version = excluded.version,
           updated_at = excluded.updated_at`
      )
      .run(
        provider,
        baseUrl === undefined ? (existing?.base_url ?? null) : baseUrl,
        storedToken,
        fieldMapJson === undefined ? (existing?.field_map_json ?? "{}") : fieldMapJson,
        input.enabled === undefined ? (existing?.enabled ?? 1) : input.enabled ? 1 : 0,
        version + 1,
        new Date().toISOString()
      );
  });
  write.immediate();
  return getAtsConnection(provider)!;
}

/** Remove a connection. Its ats_links are NOT dropped here — see deleteAtsLinksForProvider,
 *  which the caller invokes deliberately: forgetting the links means a re-connect re-imports
 *  every candidate as new, so that is a decision, not a side effect of deleting a token. */
export function deleteAtsConnection(provider: string): boolean {
  return db().prepare(`DELETE FROM ats_connections WHERE provider = ?`).run(provider).changes > 0;
}
