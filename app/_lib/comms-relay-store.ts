import type Database from "better-sqlite3";
import { openStore } from "./db-path";
import { assertPublicHttpsEndpoint } from "./safe-url.ts";
import { decryptAtsSecret, encryptAtsSecret, isEncryptedAtsSecret } from "./ats-secret.ts";

// Outbound COMMS relay config — the missing UI-backed twin of COMMS_WEBHOOK_URL
// (which stays the env override; see comms-relay.ts for precedence). Copies the
// ats-config-store pattern wholesale: its OWN isolated connection on the shared
// kp.sqlite, ONE row (id = 1), the write-only secret doctrine (the API/UI read
// `hasSecret`, never the secret), and at-rest AES-256-GCM encryption via the
// shared ats-secret helpers (generic AES-GCM under KP_SECRET, not ATS-specific).

export type CommsRelayPublic = {
  url: string | null;
  hasSecret: boolean;
};

export class CommsRelayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommsRelayError";
  }
}

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  const d = openStore();
  d.exec(`
    CREATE TABLE IF NOT EXISTS comms_relay_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      relay_url TEXT,
      relay_secret TEXT,
      updated_at TEXT
    );
  `);
  _db = d;
  return d;
}

type Row = { relay_url: string | null; relay_secret: string | null };

function readRow(): Row | undefined {
  return db().prepare(`SELECT relay_url, relay_secret FROM comms_relay_config WHERE id = 1`).get() as Row | undefined;
}

/** The client-safe view — never includes the secret. */
export function getRelayConfig(): CommsRelayPublic {
  const row = readRow();
  return { url: row?.relay_url ?? null, hasSecret: !!row?.relay_secret };
}

/** Server-internal: the DECRYPTED signing secret, or null. Never goes over the
 *  API. Legacy plaintext tolerated, re-encrypted on the next write (ats doctrine). */
export function getRelaySecret(): string | null {
  const stored = readRow()?.relay_secret ?? null;
  if (stored === null) return null;
  return isEncryptedAtsSecret(stored) ? decryptAtsSecret(stored) : stored;
}

function validateUrl(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null; // disable
  if (typeof raw !== "string") throw new CommsRelayError("url must be a string or empty.");
  // SSRF guard — candidate-facing message bodies (PII) get POSTed here, the same
  // trust boundary as the ATS webhook: https-only, no internal/loopback hosts.
  try {
    return assertPublicHttpsEndpoint(raw, "url");
  } catch (e) {
    throw new CommsRelayError(e instanceof Error ? e.message : "url is not an allowed URL.");
  }
}

/**
 * Upsert the relay config. Secret handling (ats-config-store contract):
 *   • `secret` omitted (undefined) → keep the existing secret.
 *   • `secret` === "" → CLEAR it (deliveries go unsigned).
 *   • any other string → replace it (encrypted at rest).
 */
export function setRelayConfig(input: { url?: unknown; secret?: unknown }): CommsRelayPublic {
  const url = validateUrl(input.url);
  let storedSecret: string | null = readRow()?.relay_secret ?? null;
  if (input.secret !== undefined) {
    if (typeof input.secret !== "string") throw new CommsRelayError("secret must be a string.");
    if (input.secret === "") {
      storedSecret = null;
    } else {
      try {
        storedSecret = encryptAtsSecret(input.secret);
      } catch (e) {
        throw new CommsRelayError(e instanceof Error ? e.message : "Cannot store the relay signing secret.");
      }
    }
  }
  db()
    .prepare(
      `INSERT INTO comms_relay_config (id, relay_url, relay_secret, updated_at)
       VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET relay_url = excluded.relay_url, relay_secret = excluded.relay_secret, updated_at = excluded.updated_at`
    )
    .run(url, storedSecret, new Date().toISOString());
  return getRelayConfig();
}
