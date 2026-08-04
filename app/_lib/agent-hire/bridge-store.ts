import Database from "better-sqlite3";
import { openStore } from "../db-path";
import { decryptAtsSecret, encryptAtsSecret, isEncryptedAtsSecret } from "../ats-secret";

// Agent-candidate bridge — the Personas connection config (WP1).
//
// Follows the ats/connections-store.ts pattern verbatim: a lazy isolated store on
// the shared kp.sqlite, the SECRET DOCTRINE (the pk_ API key is WRITE-ONLY over
// the API — reads expose only `hasKey`; resolveBridge() is the server-internal
// reader), and AT-REST encryption (AES-256-GCM via ats-secret.ts) so the key
// never ships plaintext in a whole-DB export.
//
// One row (id 'bridge'): the Personas desktop app is a single per-deployment
// integration, like ats_config/comms_relay_config. Listed EXEMPT + LAZY in
// tenancy.ts — deployment-level config, no candidate data.
//
// Env override wins (the resolveRelay precedence model, comms-relay.ts):
// PERSONAS_BRIDGE_URL + PERSONAS_BRIDGE_KEY serve a config-less deployment and
// beat any stored row, so existing env-driven setups behave predictably.

export const DEFAULT_PERSONAS_URL = "http://127.0.0.1:9420";

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  const d = openStore();
  d.exec(`
    CREATE TABLE IF NOT EXISTS personas_bridge (
      id TEXT PRIMARY KEY,
      base_url TEXT,
      api_key TEXT,
      paired INTEGER NOT NULL DEFAULT 0,
      last_ok_at TEXT,
      updated_at TEXT
    );
  `);
  _db = d;
  return d;
}

type Row = {
  id: string;
  base_url: string | null;
  api_key: string | null;
  paired: number;
  last_ok_at: string | null;
  updated_at: string | null;
};

const ROW_ID = "bridge";

function getRow(): Row | null {
  return (db().prepare(`SELECT * FROM personas_bridge WHERE id = ?`).get(ROW_ID) as Row | undefined) ?? null;
}

/** Client-safe view — never carries the key. */
export type BridgeConfigPublic = {
  baseUrl: string;
  hasKey: boolean;
  paired: boolean;
  lastOkAt: string | null;
  /** Where the effective config comes from — env beats the stored row. */
  source: "env" | "config" | "default";
};

export type ResolvedBridge = {
  baseUrl: string;
  /** Decrypted pk_ key, or null when unpaired. Server-internal — never over the API. */
  apiKey: string | null;
  source: "env" | "config" | "default";
};

/** Effective connection, env → stored row → loopback default (resolveRelay
 *  precedence). A stored ciphertext that cannot be decrypted throws — the caller
 *  surfaces it as a bridge failure rather than silently calling keyless. */
export function resolveBridge(): ResolvedBridge {
  const envUrl = process.env.PERSONAS_BRIDGE_URL?.trim();
  const envKey = process.env.PERSONAS_BRIDGE_KEY?.trim();
  if (envUrl || envKey) {
    return { baseUrl: (envUrl || DEFAULT_PERSONAS_URL).replace(/\/+$/, ""), apiKey: envKey || null, source: "env" };
  }
  const row = getRow();
  if (row && (row.base_url || row.api_key)) {
    const stored = row.api_key;
    const apiKey = stored === null ? null : isEncryptedAtsSecret(stored) ? decryptAtsSecret(stored) : stored;
    return { baseUrl: (row.base_url || DEFAULT_PERSONAS_URL).replace(/\/+$/, ""), apiKey, source: "config" };
  }
  return { baseUrl: DEFAULT_PERSONAS_URL, apiKey: null, source: "default" };
}

export function getBridgeConfig(): BridgeConfigPublic {
  const envUrl = process.env.PERSONAS_BRIDGE_URL?.trim();
  const envKey = process.env.PERSONAS_BRIDGE_KEY?.trim();
  const row = getRow();
  if (envUrl || envKey) {
    return {
      baseUrl: (envUrl || DEFAULT_PERSONAS_URL).replace(/\/+$/, ""),
      hasKey: !!envKey,
      paired: !!envKey,
      lastOkAt: row?.last_ok_at ?? null,
      source: "env",
    };
  }
  if (row && (row.base_url || row.api_key)) {
    return {
      baseUrl: (row.base_url || DEFAULT_PERSONAS_URL).replace(/\/+$/, ""),
      hasKey: !!row.api_key,
      paired: row.paired !== 0 && !!row.api_key,
      lastOkAt: row.last_ok_at,
      source: "config",
    };
  }
  return { baseUrl: DEFAULT_PERSONAS_URL, hasKey: false, paired: false, lastOkAt: null, source: "default" };
}

/**
 * Upsert the stored config. Key handling mirrors setAtsConnection exactly:
 *   • `apiKey` omitted → keep the stored (already-encrypted) value.
 *   • `apiKey` === "" → CLEAR it (unpair without deleting the row).
 *   • any other string → replace it (encrypted).
 * The base URL is NOT run through the public-endpoint SSRF guard on purpose:
 * Personas is a local desktop app, so the target is loopback BY DESIGN —
 * assertDeliverableWebhookUrl would reject exactly the intended address.
 */
export function setBridgeConfig(input: { baseUrl?: string | null; apiKey?: string }): BridgeConfigPublic {
  const existing = getRow();
  let baseUrl = existing?.base_url ?? null;
  if (input.baseUrl !== undefined) {
    const trimmed = (input.baseUrl ?? "").trim();
    if (trimmed && !/^https?:\/\//i.test(trimmed)) {
      throw new Error("baseUrl must be an http(s) URL.");
    }
    baseUrl = trimmed || null;
  }
  let storedKey: string | null = existing?.api_key ?? null;
  let paired = existing?.paired ?? 0;
  if (input.apiKey !== undefined) {
    if (input.apiKey === "") {
      storedKey = null;
      paired = 0;
    } else {
      storedKey = encryptAtsSecret(input.apiKey);
      paired = 1;
    }
  }
  db()
    .prepare(
      `INSERT INTO personas_bridge (id, base_url, api_key, paired, last_ok_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET base_url = excluded.base_url, api_key = excluded.api_key,
         paired = excluded.paired, updated_at = excluded.updated_at`
    )
    .run(ROW_ID, baseUrl, storedKey, paired, existing?.last_ok_at ?? null, new Date().toISOString());
  return getBridgeConfig();
}

/** Stamp a successful Personas round-trip (the connection-liveness signal). */
export function markBridgeOk(): void {
  const now = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO personas_bridge (id, paired, last_ok_at, updated_at) VALUES (?, 0, ?, ?)
       ON CONFLICT(id) DO UPDATE SET last_ok_at = excluded.last_ok_at`
    )
    .run(ROW_ID, now, now);
}
