import type Database from "better-sqlite3";
import { openStore } from "./db-path";
import { addColumns } from "./db/add-columns.ts";
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
  /** The organization whose operator saved this endpoint, or null for a row written
   *  before the column existed (read as the default org — see setRelayConfig). NOT a
   *  secret: it is an org id, the same one the caller's own session carries, and the
   *  card has to be able to say whose relay this is. The delivery path refuses to POST
   *  another organization's candidate messages to it (comms.ts, F-2). */
  ownerOrgId: string | null;
};

/** The stored signing secret exists but cannot be read back — a rotated
 *  KP_ATS_SECRET_KEY/KP_SECRET, or a restore onto a host with a different env.
 *  Deliberately NOT a CommsRelayError: it is not a caller's validation problem and
 *  must not be answered as a 400 by the config route. */
export class CommsRelaySecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommsRelaySecretError";
  }
}

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
      owner_org_id TEXT,
      updated_at TEXT
    );
  `);
  // Stores older than each of these columns. `addColumns` probes and adds only what is
  // missing, and throws anything that is not a lost duplicate-column race — the
  // swallow-all `catch` this replaced also absorbed READONLY/FULL/IOERR and then memoized
  // a connection whose table lacked the column (db/add-columns.ts).
  //   • `version` — existing rows land on 0, which is what a client that has never read a
  //     version sends, so the first write after an upgrade is not spuriously refused.
  //   • `owner_org_id` (F-2) — NULLABLE with no default on purpose: a backfilled org id
  //     would be a guess, and the delivery path reads NULL as "the default org", which is
  //     what every single-org install already is. The first save after an upgrade stamps
  //     the real one.
  addColumns(d, "comms_relay_config", ["version INTEGER NOT NULL DEFAULT 0", "owner_org_id TEXT"]);
  _db = d;
  return d;
}

type Row = { relay_url: string | null; relay_secret: string | null; version: number | null; owner_org_id: string | null };

function readRow(): Row | undefined {
  return db()
    .prepare(`SELECT relay_url, relay_secret, version, owner_org_id FROM comms_relay_config WHERE id = 1`)
    .get() as Row | undefined;
}

/** The client-safe view — never includes the secret. */
export function getRelayConfig(): CommsRelayPublic {
  const row = readRow();
  return {
    url: row?.relay_url ?? null,
    hasSecret: !!row?.relay_secret,
    version: row?.version ?? 0,
    ownerOrgId: row?.owner_org_id ?? null,
  };
}

/** Server-internal: the DECRYPTED signing secret, or null. Never goes over the
 *  API. Legacy plaintext tolerated, re-encrypted on the next write (ats doctrine). */
export function getRelaySecret(): string | null {
  const stored = readRow()?.relay_secret ?? null;
  if (stored === null) return null;
  if (!isEncryptedAtsSecret(stored)) return stored;
  try {
    return decryptAtsSecret(stored);
  } catch (e) {
    // A rotated KP_SECRET / KP_ATS_SECRET_KEY, or a DB restored onto a host with a
    // rebuilt env. Rethrown as OUR error with the crypto reason folded in, so the
    // resolver can say "unreadable" and name the cause instead of the caller having
    // to pattern-match a node:crypto message (comms-relay.ts).
    throw new CommsRelaySecretError(
      `the stored ciphertext did not decrypt under the current key (${e instanceof Error ? e.message : String(e)}).`
    );
  }
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

/** The saver's organization. The column records WHO SAVED THIS ENDPOINT, so it is
 *  re-stamped on every accepted write (a re-save adopts the saver's org — that is how an
 *  install hands the relay from one org to another). Omitted it becomes NULL, which the
 *  delivery path reads as the default org; server-internal writes with no session (tests,
 *  fixtures) therefore land exactly where they did before the column existed. */
function validateOwnerOrgId(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") throw new CommsRelayError("ownerOrgId must be a string.");
  return raw.trim().slice(0, 120) || null;
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
export function setRelayConfig(input: {
  url?: unknown;
  secret?: unknown;
  expectedVersion?: unknown;
  /** The organization of the operator saving this. Re-stamped on EVERY write — see
   *  validateOwnerOrgId. The route passes the session's org (DEFAULT_ORG_ID in open mode). */
  ownerOrgId?: unknown;
}): CommsRelayPublic {
  // Validation and encryption are pure and can throw — keep them OUTSIDE the write
  // lock so a bad URL never opens a transaction.
  const url = validateUrl(input.url);
  const ownerOrgId = validateOwnerOrgId(input.ownerOrgId);
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
        `INSERT INTO comms_relay_config (id, relay_url, relay_secret, version, owner_org_id, updated_at)
         VALUES (1, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET relay_url = excluded.relay_url, relay_secret = excluded.relay_secret,
           version = excluded.version, owner_org_id = excluded.owner_org_id, updated_at = excluded.updated_at`
      )
      .run(
        url,
        nextSecret === undefined ? (current?.relay_secret ?? null) : nextSecret,
        version + 1,
        ownerOrgId,
        new Date().toISOString()
      );
  });
  // IMMEDIATE: the write lock is taken at BEGIN, so the version this reads cannot move
  // between the check and the UPDATE (.claude/CLAUDE.md, "a read→compute→write either
  // locks or re-checks"). Nothing here awaits.
  write.immediate();
  return getRelayConfig();
}
