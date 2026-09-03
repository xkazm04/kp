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
  /** Bumped on every accepted write. The editor echoes the version it read, and a
   *  write built on an older one is REFUSED rather than merged: the POST is a full
   *  replace (an absent url disables the relay, an absent secret keeps the stored
   *  one), so two operators — or one operator in two tabs — silently overwrote each
   *  other's endpoint, and the loser's outbound mail went to the wrong place with no
   *  sign anything had happened. */
  version: number;
};

export class CommsRelayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommsRelayError";
  }
}

/** A write whose `expectedVersion` is not the stored one. A REFUSAL (409), not a
 *  validation failure — nothing was written and the caller must re-read. Subclasses
 *  CommsRelayError so an existing `instanceof` catch still sees it; callers that care
 *  about the difference check this class FIRST. */
export class CommsRelayStaleError extends CommsRelayError {
  constructor(message: string) {
    super(message);
    this.name = "CommsRelayStaleError";
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
      version INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT
    );
  `);
  // Migration for stores created before the optimistic-concurrency version existed
  // (edge-config.ts idiom: try, and treat the duplicate-column error as the success
  // it is). Existing rows land on 0, which is what a client that has never read a
  // version sends — so the first write after an upgrade is not spuriously refused.
  try {
    d.exec(`ALTER TABLE comms_relay_config ADD COLUMN version INTEGER NOT NULL DEFAULT 0`);
  } catch {
    /* column already exists — the ALTER is the migration and this is idempotent */
  }
  _db = d;
  return d;
}

type Row = { relay_url: string | null; relay_secret: string | null; version: number | null };

function readRow(): Row | undefined {
  return db().prepare(`SELECT relay_url, relay_secret, version FROM comms_relay_config WHERE id = 1`).get() as Row | undefined;
}

/** The client-safe view — never includes the secret. */
export function getRelayConfig(): CommsRelayPublic {
  const row = readRow();
  return { url: row?.relay_url ?? null, hasSecret: !!row?.relay_secret, version: row?.version ?? 0 };
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
 *
 * `expectedVersion`, when given, is the version the caller READ. The whole
 * read→compute→write runs in an IMMEDIATE transaction and re-asserts it inside the
 * write lock, so a save composed against a config someone else has since replaced is
 * dropped (CommsRelayStaleError) instead of clobbering theirs. Omit it only for
 * server-internal writes with nothing to be stale about (tests, fixtures).
 */
export function setRelayConfig(input: { url?: unknown; secret?: unknown; expectedVersion?: unknown }): CommsRelayPublic {
  // Validation and encryption are pure and can throw — keep them OUTSIDE the write
  // lock so a bad URL never opens a transaction.
  const url = validateUrl(input.url);
  let nextSecret: string | null | undefined;
  if (input.secret !== undefined) {
    if (typeof input.secret !== "string") throw new CommsRelayError("secret must be a string.");
    if (input.secret === "") {
      nextSecret = null;
    } else {
      try {
        nextSecret = encryptAtsSecret(input.secret);
      } catch (e) {
        throw new CommsRelayError(e instanceof Error ? e.message : "Cannot store the relay signing secret.");
      }
    }
  }
  let expected: number | undefined;
  if (input.expectedVersion !== undefined && input.expectedVersion !== null) {
    const n = Number(input.expectedVersion);
    if (!Number.isInteger(n) || n < 0) throw new CommsRelayError("expectedVersion must be a whole number.");
    expected = n;
  }
  const write = db().transaction((): void => {
    const current = readRow();
    const version = current?.version ?? 0;
    if (expected !== undefined && expected !== version) {
      throw new CommsRelayStaleError("The relay config changed since it was read. Reload and make your change again.");
    }
    db()
      .prepare(
        `INSERT INTO comms_relay_config (id, relay_url, relay_secret, version, updated_at)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET relay_url = excluded.relay_url, relay_secret = excluded.relay_secret,
           version = excluded.version, updated_at = excluded.updated_at`
      )
      .run(url, nextSecret === undefined ? (current?.relay_secret ?? null) : nextSecret, version + 1, new Date().toISOString());
  });
  // IMMEDIATE: the write lock is taken at BEGIN, so the version this reads cannot move
  // between the check and the UPDATE (.claude/CLAUDE.md, "a read→compute→write either
  // locks or re-checks"). Nothing here awaits.
  write.immediate();
  return getRelayConfig();
}
