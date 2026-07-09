import Database from "better-sqlite3";
import { openStore } from "./db-path";
import { isAtsEvent, type AtsEventType, SUBSCRIBABLE_EVENTS } from "./ats-webhook.ts";
import { assertPublicHttpsEndpoint } from "./safe-url.ts";

// P1-5 — persistence for the outbound-webhook integration. Its OWN isolated
// connection on the shared kp.sqlite (decision-config-store / offers-store
// pattern) so it never touches the fork-active db.ts. ONE row (id = 1).
//
// SECRET DOCTRINE — the signing secret is write-only over the API: getAtsConfig()
// (what the GET endpoint + the UI read) returns `hasSecret`, NEVER the secret
// itself, so the shared key can't be exfiltrated by reading config. getAtsSecret()
// is the server-internal reader the dispatcher uses to sign. Same doctrine as the
// offer erasure token (never surfaced to the client).

export type AtsConfigPublic = {
  webhookUrl: string | null;
  events: AtsEventType[];
  hasSecret: boolean;
};

export class AtsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AtsConfigError";
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
      updated_at TEXT
    );
  `);
  _db = d;
  return d;
}

type Row = { webhook_url: string | null; webhook_secret: string | null; events_json: string };

function readRow(): Row | undefined {
  return db().prepare(`SELECT webhook_url, webhook_secret, events_json FROM ats_config WHERE id = 1`).get() as Row | undefined;
}

function parseEvents(json: string): AtsEventType[] {
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.filter(isAtsEvent).filter((e) => e !== "ping");
  } catch {
    return [];
  }
}

/** The client-safe view — never includes the secret. */
export function getAtsConfig(): AtsConfigPublic {
  const row = readRow();
  return {
    webhookUrl: row?.webhook_url ?? null,
    events: row ? parseEvents(row.events_json) : [],
    hasSecret: !!row?.webhook_secret,
  };
}

/** Server-internal: the signing secret, or null. Never goes over the API. */
export function getAtsSecret(): string | null {
  return readRow()?.webhook_secret ?? null;
}

function validateUrl(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null; // disable
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

function validateEvents(raw: unknown): AtsEventType[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new AtsConfigError("events must be an array.");
  const out: AtsEventType[] = [];
  for (const e of raw) {
    if (!isAtsEvent(e) || e === "ping") throw new AtsConfigError(`unknown event "${String(e)}". Allowed: ${SUBSCRIBABLE_EVENTS.join(", ")}.`);
    if (!out.includes(e)) out.push(e);
  }
  return out;
}

/**
 * Upsert the webhook config. Secret handling:
 *   • `webhookSecret` omitted (undefined) → keep the existing secret.
 *   • `webhookSecret` === "" → CLEAR the secret (deliveries go unsigned).
 *   • any other string → replace it.
 * Validates at the write boundary (AtsConfigError → the route maps to 400).
 */
export function setAtsConfig(input: { webhookUrl?: unknown; webhookSecret?: unknown; events?: unknown }): AtsConfigPublic {
  const url = validateUrl(input.webhookUrl);
  const events = validateEvents(input.events);
  let secret = getAtsSecret();
  if (input.webhookSecret !== undefined) {
    if (typeof input.webhookSecret !== "string") throw new AtsConfigError("webhookSecret must be a string.");
    secret = input.webhookSecret === "" ? null : input.webhookSecret;
  }
  db()
    .prepare(
      `INSERT INTO ats_config (id, webhook_url, webhook_secret, events_json, updated_at)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET webhook_url = excluded.webhook_url, webhook_secret = excluded.webhook_secret,
         events_json = excluded.events_json, updated_at = excluded.updated_at`
    )
    .run(url, secret, JSON.stringify(events), new Date().toISOString());
  return getAtsConfig();
}
