// The local half of the edge pairing (docs/concepts/local-first-edge.md §3.2):
// where the edge lives, the shared HMAC secret, this install's sealing keypair, and
// the drain cursor.
//
// Modeled on comms-relay-store.ts down to the details, because it is the same kind
// of thing and an operator should only have to learn this pattern once: its OWN
// isolated better-sqlite3 connection on the shared kp.sqlite, ONE row (id = 1), the
// write-only credential doctrine (readers learn `hasSecret`, never the secret), and
// AES-256-GCM at rest under KP_SECRET.
//
// PRECEDENCE, identical to resolveRelay's and for the identical reason (an existing
// deploy's env must keep winning after the UI exists): env ▸ stored config ▸ nothing.
// `KP_OFFLINE=1` overrides both — an air-gapped install has no edge, and saying so
// here means no caller has to remember it.

import type Database from "better-sqlite3";
import { openStore } from "./db-path";
import { assertPublicHttpsEndpoint } from "./safe-url";
import { decryptAtsSecret, encryptAtsSecret, isEncryptedAtsSecret } from "./ats-secret";
import { generateEdgeKeypair } from "./edge-crypto";

export class EdgeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EdgeConfigError";
  }
}

/** The client-safe view. Never carries the secret or the private key. */
export type EdgePublicConfig = {
  url: string | null;
  hasSecret: boolean;
  /** Whether this install has a sealing keypair, i.e. whether the edge is able to
   *  store event bodies it cannot read. False is a legitimate state (the edge then
   *  holds cleartext), and the UI says which one is true rather than implying the
   *  safer one. */
  sealed: boolean;
  cursor: number;
  lastDrainAt: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  /** Where a "your studio has mail" nudge is sent. An ntfy topic URL, a webhook, or
   *  null (the edge then still counts, and nothing is sent). */
  nudgeTarget: string | null;
  /** env ▸ config ▸ null, so the editor can say the env var is in charge. */
  envConfigured: boolean;
  /** KP_OFFLINE=1 — the edge is off regardless of everything above. */
  offline: boolean;
};

/** Server-internal: everything the drain actually needs, resolved through the
 *  precedence rules. `null` means "no edge configured", which is the DEFAULT and a
 *  perfectly good state — L0's pull sources and the direct receiver still work. */
export type ResolvedEdge = {
  url: string;
  secret: string;
  /** Null when this install has no keypair yet: bodies then arrive in cleartext. */
  privateJwk: string | null;
  cursor: number;
  source: "env" | "config";
};

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  const d = openStore();
  d.exec(`
    CREATE TABLE IF NOT EXISTS edge_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      edge_url TEXT,
      edge_secret TEXT,
      public_jwk TEXT,
      private_jwk TEXT,
      cursor INTEGER NOT NULL DEFAULT 0,
      last_drain_at TEXT,
      last_heartbeat_at TEXT,
      last_error TEXT,
      nudge_target TEXT,
      updated_at TEXT
    );
  `);
  _db = d;
  return d;
}

type Row = {
  edge_url: string | null;
  edge_secret: string | null;
  public_jwk: string | null;
  private_jwk: string | null;
  cursor: number;
  last_drain_at: string | null;
  last_heartbeat_at: string | null;
  last_error: string | null;
  nudge_target: string | null;
};

function readRow(): Row | undefined {
  return db()
    .prepare(
      `SELECT edge_url, edge_secret, public_jwk, private_jwk, cursor, last_drain_at,
              last_heartbeat_at, last_error, nudge_target
         FROM edge_config WHERE id = 1`
    )
    .get() as Row | undefined;
}

function decrypt(stored: string | null): string | null {
  if (stored === null) return null;
  // Legacy plaintext tolerated and re-encrypted on the next write (ats doctrine).
  return isEncryptedAtsSecret(stored) ? decryptAtsSecret(stored) : stored;
}

/** Is this install air-gapped? Checked here so no caller can forget it. */
export function edgeOffline(): boolean {
  return process.env.KP_OFFLINE === "1";
}

export function getEdgeConfig(): EdgePublicConfig {
  let row: Row | undefined;
  try {
    row = readRow();
  } catch {
    // A misconfigured store (an undecryptable secret, a locked file) must not take
    // the capability read down — resolveEdge() treats it as unconfigured too.
    row = undefined;
  }
  return {
    url: process.env.KP_EDGE_URL?.trim() || row?.edge_url || null,
    hasSecret: Boolean(process.env.KP_EDGE_SECRET || row?.edge_secret),
    sealed: Boolean(row?.private_jwk),
    cursor: row?.cursor ?? 0,
    lastDrainAt: row?.last_drain_at ?? null,
    lastHeartbeatAt: row?.last_heartbeat_at ?? null,
    lastError: row?.last_error ?? null,
    nudgeTarget: process.env.KP_NUDGE_TARGET?.trim() || row?.nudge_target || null,
    envConfigured: Boolean(process.env.KP_EDGE_URL),
    offline: edgeOffline(),
  };
}

/** The drain's resolver. See ResolvedEdge; null = no edge, which is not an error. */
export function resolveEdge(): ResolvedEdge | null {
  if (edgeOffline()) return null;
  let row: Row | undefined;
  try {
    row = readRow();
  } catch {
    return null;
  }
  const envUrl = process.env.KP_EDGE_URL?.trim();
  const envSecret = process.env.KP_EDGE_SECRET?.trim();
  const url = envUrl || row?.edge_url || null;
  if (!url) return null;
  const secret = envUrl ? envSecret || decrypt(row?.edge_secret ?? null) : decrypt(row?.edge_secret ?? null) || envSecret || null;
  // No secret, no drain. An UNSIGNED drain would accept events from anyone who
  // learned the edge URL, and those events file candidates and send mail — so the
  // honest answer to "paired but unauthenticated" is "not paired".
  if (!secret) return null;
  return {
    url: url.replace(/\/+$/, ""),
    secret,
    privateJwk: decrypt(row?.private_jwk ?? null),
    cursor: row?.cursor ?? 0,
    source: envUrl ? "env" : "config",
  };
}

function validateUrl(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null; // unpair
  if (typeof raw !== "string") throw new EdgeConfigError("url must be a string or empty.");
  try {
    return assertPublicHttpsEndpoint(raw, "url").replace(/\/+$/, "");
  } catch (e) {
    throw new EdgeConfigError(e instanceof Error ? e.message : "url is not an allowed URL.");
  }
}

/**
 * Pair (or unpair) the edge.
 *
 * Secret handling is the ats-config-store contract: omitted keeps, "" clears, a
 * string replaces. Unpairing (url = null) also RESETS the cursor: a later re-pair
 * to a different edge must not resume at a sequence number that edge never issued —
 * it would skip every event below it, silently.
 */
export function setEdgeConfig(input: { url?: unknown; secret?: unknown; nudgeTarget?: unknown }): EdgePublicConfig {
  const url = validateUrl(input.url);
  // Validate and ENCRYPT before the transaction opens: better-sqlite3 transactions
  // are synchronous and must stay short, and a throw inside one would roll the write
  // back anyway. `undefined` here means "keep what is stored" (ats-config contract).
  let nextSecret: string | null | undefined;
  if (input.secret !== undefined) {
    if (typeof input.secret !== "string") throw new EdgeConfigError("secret must be a string.");
    if (input.secret === "") nextSecret = null;
    else {
      try {
        nextSecret = encryptAtsSecret(input.secret);
      } catch (e) {
        throw new EdgeConfigError(e instanceof Error ? e.message : "Cannot store the edge secret.");
      }
    }
  }
  let nextNudge: string | null | undefined;
  if (input.nudgeTarget !== undefined) {
    if (input.nudgeTarget === null || input.nudgeTarget === "") nextNudge = null;
    else if (typeof input.nudgeTarget !== "string") throw new EdgeConfigError("nudgeTarget must be a string.");
    else nextNudge = validateUrl(input.nudgeTarget);
  }
  const now = new Date().toISOString();
  // READ→COMPUTE→WRITE, so it LOCKS. "Keep the stored secret" is computed from a row
  // read here; a plain sequence of two statements lets a concurrent save land between
  // them and this write then carries the OTHER save's secret forward as if it were
  // ours. IMMEDIATE takes the write lock at BEGIN, which is the repo's first strategy
  // for exactly this shape (see actOnPipelineEntry).
  db()
    .transaction(() => {
      const row = readRow();
      const storedSecret = nextSecret === undefined ? (row?.edge_secret ?? null) : nextSecret;
      const nudgeTarget = nextNudge === undefined ? (row?.nudge_target ?? null) : nextNudge;
      db()
        .prepare(
          `INSERT INTO edge_config (id, edge_url, edge_secret, nudge_target, cursor, last_error, updated_at)
       VALUES (1, ?, ?, ?, COALESCE((SELECT cursor FROM edge_config WHERE id = 1), 0), NULL, ?)
       ON CONFLICT(id) DO UPDATE SET
         edge_url = excluded.edge_url,
         edge_secret = excluded.edge_secret,
         nudge_target = excluded.nudge_target,
         cursor = CASE WHEN excluded.edge_url IS NULL THEN 0 ELSE edge_config.cursor END,
         last_error = NULL,
         updated_at = excluded.updated_at`
        )
        .run(url, url ? storedSecret : null, nudgeTarget, now);
    })
    .immediate();
  return getEdgeConfig();
}

/** Mint this install's sealing keypair if it has none, and return the PUBLIC half
 *  to hand to the edge. Idempotent: an existing keypair is reused, because rotating
 *  it would make every event already sealed to the old key unreadable.
 *
 *  MINTS ONCE, even under concurrent callers. Key generation is ASYNC (RSA-2048 via
 *  WebCrypto), so it cannot happen inside a better-sqlite3 transaction — an `await`
 *  between BEGIN and COMMIT silently drops the atomicity. The bridge is therefore the
 *  repo's other legal strategy for a read→compute→write: a compensating precondition
 *  in the UPDATE (`public_jwk IS NULL`) plus a `changes === 0` re-read. Two clicks on
 *  "Enable sealing" now publish ONE key instead of two, the second call returning the
 *  winner — the alternative was a second keypair orphaning everything sealed to the
 *  first, unrecoverably. */
export async function ensureEdgeKeypair(): Promise<string> {
  const row = readRow();
  if (row?.public_jwk && row?.private_jwk) return row.public_jwk;
  const { publicJwk, privateJwk } = await generateEdgeKeypair();
  const sealedPrivate = encryptAtsSecret(privateJwk);
  const res = db()
    .prepare(
      `INSERT INTO edge_config (id, public_jwk, private_jwk, cursor, updated_at)
       VALUES (1, ?, ?, 0, ?)
       ON CONFLICT(id) DO UPDATE SET
         public_jwk = excluded.public_jwk,
         private_jwk = excluded.private_jwk,
         updated_at = excluded.updated_at
       WHERE edge_config.public_jwk IS NULL OR edge_config.private_jwk IS NULL`
    )
    .run(publicJwk, sealedPrivate, new Date().toISOString());
  if (res.changes === 0) {
    // Somebody else minted while we were generating. Theirs is the published one.
    const winner = readRow();
    if (winner?.public_jwk) return winner.public_jwk;
    throw new EdgeConfigError("Could not store the sealing keypair.");
  }
  return publicJwk;
}

/** Advance the drain cursor. Called ONLY after the events up to `cursor` have been
 *  applied AND acked, so a crash between apply and ack replays rather than skips. */
export function recordDrain(result: { cursor: number; error: string | null }): void {
  db()
    .prepare(
      `INSERT INTO edge_config (id, cursor, last_drain_at, last_error, updated_at)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         cursor = MAX(edge_config.cursor, excluded.cursor),
         last_drain_at = excluded.last_drain_at,
         last_error = excluded.last_error,
         updated_at = excluded.updated_at`
    )
    .run(result.cursor, new Date().toISOString(), result.error, new Date().toISOString());
}

export function recordHeartbeat(): void {
  db()
    .prepare(
      `INSERT INTO edge_config (id, cursor, last_heartbeat_at, updated_at) VALUES (1, 0, ?, ?)
       ON CONFLICT(id) DO UPDATE SET last_heartbeat_at = excluded.last_heartbeat_at, updated_at = excluded.updated_at`
    )
    .run(new Date().toISOString(), new Date().toISOString());
}
