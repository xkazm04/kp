import Database from "better-sqlite3";
import { openStore } from "./db-path";
import { isAtsEvent, type AtsEventType, SUBSCRIBABLE_EVENTS } from "./ats-webhook.ts";
import { assertPublicHttpsEndpoint } from "./safe-url.ts";
import { decryptAtsSecret, encryptAtsSecret, isEncryptedAtsSecret } from "./ats-secret.ts";

// P1-5 — persistence for the outbound-webhook integration. Its OWN isolated
// connection on the shared kp.sqlite (decision-config-store / offers-store
// pattern) so it never touches the fork-active db.ts. ONE row (id = 1).
//
// SECRET DOCTRINE — the signing secret is write-only over the API: getAtsConfig()
// (what the GET endpoint + the UI read) returns `hasSecret`, NEVER the secret
// itself, so the shared key can't be exfiltrated by reading config. getAtsSecret()
// is the server-internal reader the dispatcher uses to sign. Same doctrine as the
// offer erasure token (never surfaced to the client).
//
// AT REST — the doctrine above only guarded the API READ path; the secret was still
// persisted PLAINTEXT, so the whole-DB export (db-portability dumps every column)
// shipped it in clear. It is now ENCRYPTED at rest (ats-secret.ts, AES-256-GCM under
// KP_ATS_SECRET_KEY/KP_SECRET): the column holds only ciphertext, so neither the
// export nor a raw `sqlite3` read ever sees the secret. getAtsSecret() decrypts it
// transiently to sign; a legacy plaintext row is tolerated and re-encrypted on the
// next write.

export type AtsConfigPublic = {
  webhookUrl: string | null;
  events: AtsEventType[];
  hasSecret: boolean;
  /** Bumped on every accepted write. The panel echoes the version it READ, and the
   *  store re-asserts it under the write lock — so two operators (or two tabs) editing
   *  the endpoint and its event subscriptions no longer silently clobber each other.
   *  Mirrors comms-relay-store.ts, the same doctrine on the same kind of document. */
  version: number;
};

export class AtsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AtsConfigError";
  }
}

/** A write composed against a config someone else has since replaced. Subclasses
 *  AtsConfigError so an existing `instanceof AtsConfigError` catch still sees it —
 *  the route checks this FIRST, because it is a 409 refusal (nothing was written),
 *  not a 400 validation failure. */
export class AtsConfigStaleError extends AtsConfigError {
  constructor(message: string) {
    super(message);
    this.name = "AtsConfigStaleError";
  }
}

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  const d = openStore();
  d.exec(`
    CREATE TABLE IF NOT EXISTS ats_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      webhook_url TEXT,
      webhook_secret TEXT,
      events_json TEXT NOT NULL DEFAULT '[]',
      version INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT
    );
  `);
  // Stores created before optimistic concurrency existed have no `version` column.
  // ADD COLUMN with a DEFAULT backfills every existing row to 0 — exactly the version a
  // panel that has just read one sends, so the first write after an upgrade is not
  // spuriously refused.
  try {
    d.exec(`ALTER TABLE ats_config ADD COLUMN version INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Already present (the CREATE TABLE above just made it, or an earlier boot did) —
    // the only expected failure here, and re-adding is the no-op we want.
  }
  _db = d;
  return d;
}

type Row = { webhook_url: string | null; webhook_secret: string | null; events_json: string; version: number | null };

function readRow(): Row | undefined {
  return db()
    .prepare(`SELECT webhook_url, webhook_secret, events_json, version FROM ats_config WHERE id = 1`)
    .get() as Row | undefined;
}

/** The stored subscription list, or `[]`. `[]` also means "unsubscribed from
 *  everything", which is why the corrupt cases are LOGGED with the row they came from:
 *  a config row whose events_json cannot be read silently turned every subscription off
 *  and looked exactly like an operator who had turned them off, so a deployment could
 *  stop mirroring hires with nothing anywhere saying why. `rowId` is the ats_config row
 *  (always 1 — the store is single-row) so the log line names something greppable. */
function parseEvents(json: string, rowId: number = 1): AtsEventType[] {
  let arr: unknown;
  try {
    arr = JSON.parse(json);
  } catch (e) {
    console.error(
      `[ats] ats_config row ${rowId}: events_json is not valid JSON — NO events are subscribed until it is repaired:`,
      e instanceof Error ? e.message : e
    );
    return [];
  }
  if (!Array.isArray(arr)) {
    console.error(`[ats] ats_config row ${rowId}: events_json is ${typeof arr}, not an array — NO events are subscribed.`);
    return [];
  }
  const known = arr.filter(isAtsEvent).filter((e) => e !== "ping");
  if (known.length !== arr.length) {
    const dropped = arr.filter((e) => !isAtsEvent(e));
    if (dropped.length) {
      console.error(`[ats] ats_config row ${rowId}: dropping unknown subscribed event(s) ${JSON.stringify(dropped)}.`);
    }
  }
  return known;
}

/** The client-safe view — never includes the secret. */
export function getAtsConfig(): AtsConfigPublic {
  const row = readRow();
  return {
    webhookUrl: row?.webhook_url ?? null,
    events: row ? parseEvents(row.events_json) : [],
    hasSecret: !!row?.webhook_secret,
    version: row?.version ?? 0,
  };
}

/** Server-internal: the DECRYPTED signing secret, or null. Never goes over the API.
 *  A legacy plaintext row (written before at-rest encryption) is returned as-is so an
 *  existing integration keeps signing; the next setAtsConfig write re-stores it
 *  encrypted. Throws only if the ciphertext can't be decrypted (missing/rotated key)
 *  — deliver() wraps this so a misconfiguration surfaces as a delivery failure. */
export function getAtsSecret(): string | null {
  const stored = readRow()?.webhook_secret ?? null;
  if (stored === null) return null;
  return isEncryptedAtsSecret(stored) ? decryptAtsSecret(stored) : stored;
}

function validateUrl(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined; // omitted → keep what is stored
  if (raw === null || raw === "") return null; // disable
  if (typeof raw !== "string") throw new AtsConfigError("webhookUrl must be a string or empty.");
  // SSRF guard — the server later POSTs candidate PII (and a signed body) to this
  // URL, so it is the same trust boundary as a provider endpoint. Route it through
  // the shared `assertPublicHttpsEndpoint`: https-only, and reject bare IP literals
  // (169.254.169.254 metadata, 127.x loopback, RFC-1918 LAN) and internal/`.local`/
  // `.internal` hostnames. This closes the config-WRITE boundary; deliver() re-vets
  // (and resolves) the host at fetch time, since a URL can be stored before a rule
  // tightens and DNS can change under a stored name.
  try {
    return assertPublicHttpsEndpoint(raw, "webhookUrl");
  } catch (e) {
    throw new AtsConfigError(e instanceof Error ? e.message : "webhookUrl is not an allowed URL.");
  }
}

function validateEvents(raw: unknown): AtsEventType[] | undefined {
  if (raw === undefined) return undefined; // omitted → keep the stored subscriptions
  if (raw === null) return [];
  if (!Array.isArray(raw)) throw new AtsConfigError("events must be an array.");
  const out: AtsEventType[] = [];
  for (const e of raw) {
    if (!isAtsEvent(e) || e === "ping") throw new AtsConfigError(`unknown event "${String(e)}". Allowed: ${SUBSCRIBABLE_EVENTS.join(", ")}.`);
    if (!out.includes(e)) out.push(e);
  }
  return out;
}

/**
 * Upsert the webhook config. Every field is a PARTIAL update — omitted means KEEP:
 *   • `webhookUrl` omitted → keep the stored endpoint; `null`/`""` → CLEAR (disable).
 *   • `events` omitted → keep the stored subscriptions; `[]`/`null` → unsubscribe all.
 *   • `webhookSecret` omitted → keep the existing secret; `""` → CLEAR it (deliveries
 *     go unsigned); any other string → replace it (encrypted at rest).
 *
 * It used to be a whole-DOCUMENT write: `webhookUrl` and `events` were resolved to
 * null/[] when absent, so a client that meant to change one field had to resend all of
 * them — and two operators editing the panel side by side silently clobbered each
 * other's event subscriptions. The inbound ATS panel next to it already sent partials
 * (IntegrationsAtsPanel); this is the same contract on the outbound half.
 *
 * `expectedVersion`, when given, is the version the caller READ. The read→compute→write
 * runs in an IMMEDIATE transaction and re-asserts it INSIDE the write lock, so a save
 * composed against a config someone else has since replaced is dropped
 * (AtsConfigStaleError → a 409 the panel offers a reload for) rather than applied on top
 * of theirs. Omit it only for server-internal writes with no read to be stale about
 * (tests, fixtures) — see comms-relay-store.ts, the same doctrine.
 *
 * Validation throws AtsConfigError, which the route maps to a 400.
 */
export function setAtsConfig(input: {
  webhookUrl?: unknown;
  webhookSecret?: unknown;
  events?: unknown;
  expectedVersion?: unknown;
}): AtsConfigPublic {
  // Validation and encryption are pure and can throw — keep them OUTSIDE the write lock
  // so a bad URL never opens a transaction.
  const url = validateUrl(input.webhookUrl);
  const events = validateEvents(input.events);
  let nextSecret: string | null | undefined;
  if (input.webhookSecret !== undefined) {
    if (typeof input.webhookSecret !== "string") throw new AtsConfigError("webhookSecret must be a string.");
    if (input.webhookSecret === "") {
      nextSecret = null; // CLEAR — deliveries go unsigned
    } else {
      // Encrypt at rest — the signing secret must never be persisted (or exported) in
      // clear. Refuse rather than fall back to plaintext when no key is configured
      // (same stance as provider keys in llm-secret.ts).
      try {
        nextSecret = encryptAtsSecret(input.webhookSecret);
      } catch (e) {
        throw new AtsConfigError(e instanceof Error ? e.message : "Cannot store the webhook signing secret.");
      }
    }
  }
  let expected: number | undefined;
  if (input.expectedVersion !== undefined && input.expectedVersion !== null) {
    const n = Number(input.expectedVersion);
    if (!Number.isInteger(n) || n < 0) throw new AtsConfigError("expectedVersion must be a whole number.");
    expected = n;
  }
  const write = db().transaction((): void => {
    const current = readRow();
    const version = current?.version ?? 0;
    if (expected !== undefined && expected !== version) {
      throw new AtsConfigStaleError("The webhook config changed since it was read. Reload and make your change again.");
    }
    // Preserve the EXISTING stored (already-encrypted) secret when the caller omits
    // webhookSecret — read the RAW column, never the decrypted plaintext, so a
    // keep-existing write can't round-trip the secret back to plaintext.
    db()
      .prepare(
        `INSERT INTO ats_config (id, webhook_url, webhook_secret, events_json, version, updated_at)
         VALUES (1, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET webhook_url = excluded.webhook_url, webhook_secret = excluded.webhook_secret,
           events_json = excluded.events_json, version = excluded.version, updated_at = excluded.updated_at`
      )
      .run(
        url === undefined ? (current?.webhook_url ?? null) : url,
        nextSecret === undefined ? (current?.webhook_secret ?? null) : nextSecret,
        JSON.stringify(events ?? (current ? parseEvents(current.events_json) : [])),
        version + 1,
        new Date().toISOString()
      );
  });
  // IMMEDIATE: the write lock is taken at BEGIN, so the version this reads cannot move
  // between the check and the UPDATE (.claude/CLAUDE.md, "a read→compute→write either
  // locks or re-checks"). Nothing here awaits.
  write.immediate();
  return getAtsConfig();
}
