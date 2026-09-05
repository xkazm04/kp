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

/** The closed vocabulary of drain failures. Literal array + derived union + runtime
 *  guard, the repo's shape for a closed vocabulary (tabs.ts, i18n/locales.ts) — the
 *  card owes one message per member and `i18n:check` cannot see a string built at
 *  runtime, so the union is what keeps the four catalogs honest. */
export const EDGE_ERROR_KINDS = ["unreachable", "held", "ack", "secret_unreadable", "unknown"] as const;
export type EdgeErrorKind = (typeof EDGE_ERROR_KINDS)[number];
export function isEdgeErrorKind(v: unknown): v is EdgeErrorKind {
  return typeof v === "string" && (EDGE_ERROR_KINDS as readonly string[]).includes(v);
}

export class EdgeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EdgeConfigError";
  }
}

/** The client-safe view. Never carries the secret or the private key. */
export type EdgePublicConfig = {
  url: string | null;
  /** A secret is on file AND this install can still open it. Those are not the same
   *  fact: a rotated KP_SECRET leaves the ciphertext in place and unreadable, and a
   *  card that answered "paired" from the column's mere presence painted green over
   *  a pairing that could never drain again. */
  hasSecret: boolean;
  /** Whether this install has a sealing keypair, i.e. whether the edge is able to
   *  store event bodies it cannot read. False is a legitimate state (the edge then
   *  holds cleartext), and the UI says which one is true rather than implying the
   *  safer one. */
  sealed: boolean;
  cursor: number;
  lastDrainAt: string | null;
  lastHeartbeatAt: string | null;
  /** Events still waiting at the edge after the last drain, as the edge itself
   *  reported them. NULL means "not known yet" — never 0, because "the queue is
   *  empty" and "we have never asked" are different facts and the card says which. */
  pending: number | null;
  /** The raw diagnostic, for the operator's server-side eye. The CARD renders
   *  `lastErrorKind` instead: a machine string like `HTTP 502` is not a sentence in
   *  any of the four languages this app ships. */
  lastError: string | null;
  /** The CLASS of the last failure, which is what a reader can act on:
   *  `unreachable` (the edge did not answer), `held` (an event could not be filed
   *  and stays queued), `ack` (events were filed but the edge was not told, so it
   *  re-serves them harmlessly), `secret_unreadable` (the stored credential is
   *  sealed under a key this install no longer has: nothing drains until the key is
   *  restored or the pairing is re-entered). NULL when the last drain was clean. */
  lastErrorKind: EdgeErrorKind | null;
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
      last_error_kind TEXT,
      pending INTEGER,
      nudge_target TEXT,
      updated_at TEXT
    );
  `);
  // Migrations for stores created before the drain LEDGER existed. The card used to
  // show two facts (cursor, last error) while the engine already knew four; `pending`
  // in particular was fetched on every drain and thrown away, so a 500-event backlog
  // looked identical to an empty queue. Same idiom as offers-store.ts: try, and treat
  // the duplicate-column error as the success it is.
  for (const column of ["last_error_kind TEXT", "pending INTEGER"]) {
    try {
      d.exec(`ALTER TABLE edge_config ADD COLUMN ${column}`);
    } catch {
      /* column already exists — the ALTER is the migration and this is idempotent */
    }
  }
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
  last_error_kind: string | null;
  pending: number | null;
  nudge_target: string | null;
};

function readRow(): Row | undefined {
  return db()
    .prepare(
      `SELECT edge_url, edge_secret, public_jwk, private_jwk, cursor, last_drain_at,
              last_heartbeat_at, last_error, last_error_kind, pending, nudge_target
         FROM edge_config WHERE id = 1`
    )
    .get() as Row | undefined;
}

/** Decrypt WITHOUT throwing. `ok: false` is the one interesting failure: neither the
 *  current nor the retired key opens the row (see decryptAtsSecretDetailed), i.e. a
 *  rotation that ran ahead of `secrets:rotate`. Every caller here is on a path whose
 *  contract is "never throws" (the drain's ledger, the card's read), so the failure
 *  is DATA, the way this repo answers with a code rather than an exception. */
type Decrypted = { ok: true; value: string | null } | { ok: false; error: string };

function tryDecrypt(stored: string | null): Decrypted {
  if (stored === null) return { ok: true, value: null };
  // Legacy plaintext tolerated and re-encrypted on the next write (ats doctrine).
  if (!isEncryptedAtsSecret(stored)) return { ok: true, value: stored };
  try {
    return { ok: true, value: decryptAtsSecret(stored) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The stored edge secret could not be decrypted." };
  }
}

function readableSecret(row: Row | undefined): boolean {
  const stored = tryDecrypt(row?.edge_secret ?? null);
  return stored.ok && stored.value !== null;
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
    // Decrypting on every read is ONE AES-256-GCM open of a short string, cheaper
    // than the SELECT above, and the only way this answer can be true. The env
    // secret short-circuits it: when the env var is in charge the stored row is not
    // consulted at all, here or in resolveEdgeDetailed.
    hasSecret: Boolean(process.env.KP_EDGE_SECRET) || readableSecret(row),
    sealed: Boolean(row?.private_jwk),
    cursor: row?.cursor ?? 0,
    lastDrainAt: row?.last_drain_at ?? null,
    lastHeartbeatAt: row?.last_heartbeat_at ?? null,
    pending: typeof row?.pending === "number" ? row.pending : null,
    lastError: row?.last_error ?? null,
    lastErrorKind: isEdgeErrorKind(row?.last_error_kind) ? row.last_error_kind : null,
    nudgeTarget: process.env.KP_NUDGE_TARGET?.trim() || row?.nudge_target || null,
    envConfigured: Boolean(process.env.KP_EDGE_URL),
    offline: edgeOffline(),
  };
}

/** What the resolver found. `ok: true` with `edge: null` is the DEFAULT and not an
 *  error (no edge configured, or air-gapped); `ok: false` is the one state a caller
 *  must REPORT rather than treat as "nothing to do", because a stored pairing exists
 *  and is unusable. Modeled on decryptAtsSecretDetailed: the detailed answer for the
 *  caller that can act on it, a one-liner for everyone else. */
export type EdgeResolution =
  | { ok: true; edge: ResolvedEdge | null }
  | { ok: false; kind: "secret_unreadable"; error: string };

/** The drain's resolver, with the failure it used to throw. Never throws. */
export function resolveEdgeDetailed(): EdgeResolution {
  if (edgeOffline()) return { ok: true, edge: null };
  let row: Row | undefined;
  try {
    row = readRow();
  } catch {
    return { ok: true, edge: null };
  }
  const envUrl = process.env.KP_EDGE_URL?.trim();
  const envSecret = process.env.KP_EDGE_SECRET?.trim();
  const url = envUrl || row?.edge_url || null;
  if (!url) return { ok: true, edge: null };
  // env ▸ stored, taken literally: with BOTH env halves set the stored ciphertext is
  // never opened, so a stale row cannot break a deploy the env var is running.
  const envInCharge = Boolean(envUrl && envSecret);
  const stored: Decrypted = envInCharge ? { ok: true, value: null } : tryDecrypt(row?.edge_secret ?? null);
  if (!stored.ok) return { ok: false, kind: "secret_unreadable", error: stored.error };
  // The private half UNSEALS bodies. Draining with it unreadable would hold on every
  // sealed event one at a time; saying so once is the answer an operator can act on.
  const privateJwk = tryDecrypt(row?.private_jwk ?? null);
  if (!privateJwk.ok) return { ok: false, kind: "secret_unreadable", error: privateJwk.error };
  const secret = envUrl ? envSecret || stored.value : stored.value || envSecret || null;
  // No secret, no drain. An UNSIGNED drain would accept events from anyone who
  // learned the edge URL, and those events file candidates and send mail — so the
  // honest answer to "paired but unauthenticated" is "not paired".
  if (!secret) return { ok: true, edge: null };
  return {
    ok: true,
    edge: {
      url: url.replace(/\/+$/, ""),
      secret,
      privateJwk: privateJwk.value,
      cursor: row?.cursor ?? 0,
      source: envUrl ? "env" : "config",
    },
  };
}

/** See ResolvedEdge; null = no edge, which is not an error. For callers with nothing
 *  to do either way; the drain uses resolveEdgeDetailed so it can REPORT an
 *  unreadable credential instead of looking idle. */
export function resolveEdge(): ResolvedEdge | null {
  const resolution = resolveEdgeDetailed();
  return resolution.ok ? resolution.edge : null;
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
export function recordDrain(result: {
  cursor: number;
  error: string | null;
  errorKind?: EdgeErrorKind | null;
  /** What the edge said is still waiting. `undefined` = we never got an answer (the
   *  drain failed before the response parsed), and the stored value is then LEFT
   *  ALONE rather than zeroed — a failed reach is not evidence the queue drained. */
  pending?: number | null;
}): void {
  const now = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO edge_config (id, cursor, last_drain_at, last_error, last_error_kind, pending, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         cursor = MAX(edge_config.cursor, excluded.cursor),
         last_drain_at = excluded.last_drain_at,
         last_error = excluded.last_error,
         last_error_kind = excluded.last_error_kind,
         pending = COALESCE(excluded.pending, edge_config.pending),
         updated_at = excluded.updated_at`
    )
    .run(
      result.cursor,
      now,
      result.error,
      result.error ? (result.errorKind ?? "unknown") : null,
      result.pending === undefined ? null : result.pending,
      now
    );
}

export function recordHeartbeat(): void {
  db()
    .prepare(
      `INSERT INTO edge_config (id, cursor, last_heartbeat_at, updated_at) VALUES (1, 0, ?, ?)
       ON CONFLICT(id) DO UPDATE SET last_heartbeat_at = excluded.last_heartbeat_at, updated_at = excluded.updated_at`
    )
    .run(new Date().toISOString(), new Date().toISOString());
}
