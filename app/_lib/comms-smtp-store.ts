import type Database from "better-sqlite3";
import { openStore } from "./db-path";
import { decryptAtsSecret, encryptAtsSecret, isEncryptedAtsSecret } from "./ats-secret.ts";

// T6 — the built-in SMTP sender's config: a mailbox the owner already has (Gmail with an
// app password, Seznam, Office 365, or any submission server), so a keyless install can
// actually send its letters without standing up a public https relay. Copies the
// comms-relay-store.ts pattern: its OWN connection on the shared kp.sqlite, ONE row
// (id = 1), version-checked writes in an IMMEDIATE transaction, the org that saved it, and
// the write-only password doctrine: the API and UI read `hasPassword`, never the password,
// which is AES-256-GCM at rest through the shared ats-secret helpers.
//
// The same row carries two small operator lists, both bounded:
//   • `suppressed` — addresses a server refused PERMANENTLY at RCPT/DATA. A later send to
//     one is refused with a named reason before any connection (comms.ts SmtpChannel).
//   • `attempts` — the last few SMTP attempts with their reply code and text, so the card
//     can show what the server actually said, including on a `sent` row (the outbox keeps
//     a detail only for failures). Never holds the password: the client redacts every text.

export type SmtpPreset = "gmail" | "seznam" | "office365" | "custom";
export type SmtpStoredSecurity = "tls" | "starttls";

export const SMTP_PRESETS: Record<Exclude<SmtpPreset, "custom">, { host: string; port: number; security: SmtpStoredSecurity }> = {
  // Gmail needs an app password (Google account, Security, App passwords); the normal
  // account password is refused with a 535.
  gmail: { host: "smtp.gmail.com", port: 465, security: "tls" },
  seznam: { host: "smtp.seznam.cz", port: 465, security: "tls" },
  office365: { host: "smtp.office365.com", port: 587, security: "starttls" },
};

export const SMTP_PRESET_IDS = ["gmail", "seznam", "office365", "custom"] as const satisfies readonly SmtpPreset[];

export function isSmtpPreset(v: unknown): v is SmtpPreset {
  return typeof v === "string" && (SMTP_PRESET_IDS as readonly string[]).includes(v);
}

export const SMTP_SUPPRESSION_MAX = 500;
export const SMTP_ATTEMPTS_MAX = 10;

export type SmtpSuppression = { address: string; code: number | null; text: string; at: string };

export type SmtpAttempt = {
  at: string;
  /** "test" for the Send test button, otherwise the letter's kind. */
  kind: string;
  to: string;
  messageId: string | null;
  outcome: "sent" | "retry" | "failed" | "refused";
  stage: string | null;
  code: number | null;
  text: string;
};

export type CommsSmtpPublic = {
  preset: SmtpPreset | null;
  host: string | null;
  port: number | null;
  security: SmtpStoredSecurity | null;
  /** The mailbox address: the From of every letter, the login, and the test recipient. */
  address: string | null;
  fromName: string | null;
  hasPassword: boolean;
  version: number;
  ownerOrgId: string | null;
  suppressed: SmtpSuppression[];
  attempts: SmtpAttempt[];
};

/** Server-internal: everything a send needs, password decrypted. Never serialized. */
export type SmtpPrivateConfig = {
  host: string;
  port: number;
  security: SmtpStoredSecurity;
  address: string;
  fromName: string | null;
  password: string;
  ownerOrgId: string | null;
};

/** The stored password exists but cannot be decrypted (a rotated key, a restore onto a
 *  host with a different env). Not a caller's validation problem: never a 400. */
export class CommsSmtpSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommsSmtpSecretError";
  }
}

/** A validation refusal. `field` names the input it is about (a fixed vocabulary the
 *  route can put on the wire as data); the message is English prose for the log. */
export class CommsSmtpError extends Error {
  constructor(
    message: string,
    readonly field: string = "body"
  ) {
    super(message);
    this.name = "CommsSmtpError";
  }
}

/** `expectedVersion` is not the stored one: nothing was written (409). Check it first. */
export class CommsSmtpStaleError extends CommsSmtpError {
  constructor(message: string) {
    super(message, "expectedVersion");
    this.name = "CommsSmtpStaleError";
  }
}

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  const d = openStore();
  d.exec(`
    CREATE TABLE IF NOT EXISTS comms_smtp_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      preset TEXT,
      host TEXT,
      port INTEGER,
      security TEXT,
      address TEXT,
      from_name TEXT,
      password TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      owner_org_id TEXT,
      suppressed TEXT,
      attempts TEXT,
      updated_at TEXT
    );
  `);
  _db = d;
  return d;
}

type Row = {
  preset: string | null;
  host: string | null;
  port: number | null;
  security: string | null;
  address: string | null;
  from_name: string | null;
  password: string | null;
  version: number | null;
  owner_org_id: string | null;
  suppressed: string | null;
  attempts: string | null;
};

function readRow(): Row | undefined {
  return db()
    .prepare(
      `SELECT preset, host, port, security, address, from_name, password, version, owner_org_id, suppressed, attempts
       FROM comms_smtp_config WHERE id = 1`
    )
    .get() as Row | undefined;
}

function parseList<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    /* a corrupt list reads as empty: it is operator telemetry, never the send decision's only input */
    return [];
  }
}

/** The client-safe view: never the password. */
export function getSmtpConfig(): CommsSmtpPublic {
  const row = readRow();
  return {
    preset: isSmtpPreset(row?.preset) ? row.preset : null,
    host: row?.host ?? null,
    port: row?.port ?? null,
    security: row?.security === "tls" || row?.security === "starttls" ? row.security : null,
    address: row?.address ?? null,
    fromName: row?.from_name ?? null,
    hasPassword: !!row?.password,
    version: row?.version ?? 0,
    ownerOrgId: row?.owner_org_id ?? null,
    suppressed: parseList<SmtpSuppression>(row?.suppressed ?? null),
    attempts: parseList<SmtpAttempt>(row?.attempts ?? null),
  };
}

/** Whether a sender is fully configured: host, port, security, address and a password.
 *  Says nothing about whether the password DECRYPTS (see getSmtpPrivateConfig). */
export function smtpConfigured(view: CommsSmtpPublic = getSmtpConfig()): boolean {
  return !!(view.host && view.port && view.security && view.address && view.hasPassword);
}

/** Server-internal: the sender with its decrypted password, or null when not fully
 *  configured. Throws CommsSmtpSecretError when the password cannot be decrypted. */
export function getSmtpPrivateConfig(): SmtpPrivateConfig | null {
  const row = readRow();
  if (!row?.host || !row.port || !row.address || !row.password) return null;
  if (row.security !== "tls" && row.security !== "starttls") return null;
  let password: string;
  if (!isEncryptedAtsSecret(row.password)) {
    password = row.password;
  } else {
    try {
      password = decryptAtsSecret(row.password);
    } catch (e) {
      // The crypto reason never contains the plaintext; it says which key failed.
      throw new CommsSmtpSecretError(
        `the stored SMTP password did not decrypt under the current key (${e instanceof Error ? e.message : String(e)}).`
      );
    }
  }
  return {
    host: row.host,
    port: row.port,
    security: row.security,
    address: row.address,
    fromName: row.from_name,
    password,
    ownerOrgId: row.owner_org_id,
  };
}

const ADDRESS = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]+$/;
const HOST = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

function str(v: unknown, field: string): string {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new CommsSmtpError(`${field} must be a string.`, field);
  return v.trim();
}

/** Whether a save sends the stored password somewhere it was not typed for: another
 *  server, another login, or another org. Port and security are not part of it: TLS
 *  still checks the same host name, and neither mode sends AUTH in clear. */
function smtpDestinationMoved(current: Row, next: { host: string; address: string; ownerOrgId: string | null }): boolean {
  return (
    (current.host ?? "").toLowerCase() !== next.host ||
    normalizeAddress(current.address ?? "") !== normalizeAddress(next.address) ||
    (current.owner_org_id ?? null) !== next.ownerOrgId
  );
}

/** Normalize an address for the suppression list. */
export function normalizeAddress(a: string): string {
  return a.trim().toLowerCase();
}

/**
 * Upsert the sender. `preset` fills host, port and security (a preset IGNORES any host
 * sent beside it); `custom` takes them from the body. An empty `address` with no host
 * disables the sender. Password handling (relay-store contract):
 *   • `password` omitted → keep the stored one, but only for the same host, address and
 *     owner org; moving any of them without a new password is refused (field `password`).
 *   • `password` === ""  → clear it (the sender stops being configured).
 *   • any other string   → replace it, encrypted at rest.
 *
 * `expectedVersion` is the version the caller READ; a write built on an older one is
 * refused under the write lock (CommsSmtpStaleError) instead of clobbering a newer save.
 * The two lists are kept across a save: they are facts about addresses, not settings.
 */
export function setSmtpConfig(input: {
  preset?: unknown;
  host?: unknown;
  port?: unknown;
  security?: unknown;
  address?: unknown;
  fromName?: unknown;
  password?: unknown;
  expectedVersion?: unknown;
  ownerOrgId?: unknown;
}): CommsSmtpPublic {
  const address = str(input.address, "address");
  const presetRaw = str(input.preset, "preset") || (address ? "custom" : "");
  let preset: SmtpPreset | null = null;
  let host: string | null = null;
  let port: number | null = null;
  let security: SmtpStoredSecurity | null = null;
  if (address || presetRaw) {
    if (!isSmtpPreset(presetRaw)) throw new CommsSmtpError("preset must be gmail, seznam, office365 or custom.", "preset");
    if (!ADDRESS.test(address)) throw new CommsSmtpError("address must be an email address.", "address");
    preset = presetRaw;
    if (preset === "custom") {
      host = str(input.host, "host").toLowerCase();
      if (!HOST.test(host)) throw new CommsSmtpError("host must be a mail server name, e.g. smtp.example.com.", "host");
      const p = Number(input.port);
      if (!Number.isInteger(p) || p < 1 || p > 65535) throw new CommsSmtpError("port must be a whole number from 1 to 65535.", "port");
      port = p;
      const s = str(input.security, "security");
      // No plain option: the password and every candidate letter would cross the network
      // in clear. A server that offers neither TLS mode is not one kp sends through.
      if (s !== "tls" && s !== "starttls") throw new CommsSmtpError("security must be tls (port 465) or starttls (port 587).", "security");
      security = s;
    } else {
      ({ host, port, security } = SMTP_PRESETS[preset]);
    }
  }
  const fromName = str(input.fromName, "fromName").replace(/[\r\n"]+/g, " ").slice(0, 120) || null;
  const ownerOrgId = input.ownerOrgId === undefined || input.ownerOrgId === null || input.ownerOrgId === "" ? null : str(input.ownerOrgId, "ownerOrgId").slice(0, 120) || null;
  let nextPassword: string | null | undefined;
  if (input.password !== undefined) {
    if (typeof input.password !== "string") throw new CommsSmtpError("password must be a string.", "password");
    if (input.password === "") {
      nextPassword = null;
    } else {
      try {
        nextPassword = encryptAtsSecret(input.password);
      } catch {
        // The helper's message names the missing key env var; it never carries the input.
        throw new CommsSmtpError("Cannot store the SMTP password: set KP_ATS_SECRET_KEY (or KP_SECRET) so it can be encrypted at rest.", "encryptionKey");
      }
    }
  }
  let expected: number | undefined;
  if (input.expectedVersion !== undefined && input.expectedVersion !== null) {
    const n = Number(input.expectedVersion);
    if (!Number.isInteger(n) || n < 0) throw new CommsSmtpError("expectedVersion must be a whole number.", "expectedVersion");
    expected = n;
  }
  const write = db().transaction((): void => {
    const current = readRow();
    const version = current?.version ?? 0;
    if (expected !== undefined && expected !== version) {
      throw new CommsSmtpStaleError("The SMTP sender changed since it was read. Reload and make your change again.");
    }
    // A kept password stays with the server, the login and the org it was typed for.
    // Without this, anyone who may save the card could re-point `host` at a server they
    // run and press Send test: the client would AUTH there with the owner's mailbox
    // password, which no API ever returns but the wire would hand over.
    if (nextPassword === undefined && current?.password && host !== null && smtpDestinationMoved(current, { host, address, ownerOrgId })) {
      throw new CommsSmtpError("Re-enter the password: the server, the address or the owning organization changed.", "password");
    }
    db()
      .prepare(
        `INSERT INTO comms_smtp_config (id, preset, host, port, security, address, from_name, password, version, owner_org_id, suppressed, attempts, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET preset = excluded.preset, host = excluded.host, port = excluded.port,
           security = excluded.security, address = excluded.address, from_name = excluded.from_name,
           password = excluded.password, version = excluded.version, owner_org_id = excluded.owner_org_id,
           updated_at = excluded.updated_at`
      )
      .run(
        preset,
        host,
        port,
        security,
        address || null,
        fromName,
        nextPassword === undefined ? (current?.password ?? null) : nextPassword,
        version + 1,
        ownerOrgId,
        current?.suppressed ?? null,
        current?.attempts ?? null,
        new Date().toISOString()
      );
  });
  // IMMEDIATE: the version read cannot move between the check and the write. No await.
  write.immediate();
  return getSmtpConfig();
}

/** Read-modify-write one JSON list column under the write lock. A no-op before any
 *  sender row exists (there is nothing to attach the list to). */
function updateList<T>(column: "suppressed" | "attempts", fn: (list: T[]) => T[]): void {
  const tx = db().transaction((): void => {
    const row = db().prepare(`SELECT ${column} AS v FROM comms_smtp_config WHERE id = 1`).get() as { v: string | null } | undefined;
    if (!row) return;
    const next = fn(parseList<T>(row.v));
    db().prepare(`UPDATE comms_smtp_config SET ${column} = ? WHERE id = 1`).run(JSON.stringify(next));
  });
  tx.immediate();
}

/** The suppression entry for an address, or null. */
export function smtpSuppressionFor(address: string): SmtpSuppression | null {
  const key = normalizeAddress(address);
  return getSmtpConfig().suppressed.find((s) => s.address === key) ?? null;
}

/** Put an address on the list (newest wins; bounded, oldest dropped first). */
export function suppressSmtpAddress(address: string, code: number | null, text: string): void {
  const key = normalizeAddress(address);
  updateList<SmtpSuppression>("suppressed", (list) =>
    [{ address: key, code, text: text.slice(0, 240), at: new Date().toISOString() }, ...list.filter((s) => s.address !== key)].slice(0, SMTP_SUPPRESSION_MAX)
  );
}

/** Take an address off the list (an owner who fixed the address, or a mailbox that is back). */
export function unsuppressSmtpAddress(address: string): boolean {
  const key = normalizeAddress(address);
  let removed = false;
  updateList<SmtpSuppression>("suppressed", (list) => {
    const next = list.filter((s) => s.address !== key);
    removed = next.length !== list.length;
    return next;
  });
  return removed;
}

/** Record one attempt (newest first, bounded). */
export function recordSmtpAttempt(attempt: Omit<SmtpAttempt, "at">): void {
  updateList<SmtpAttempt>("attempts", (list) => [{ ...attempt, text: attempt.text.slice(0, 240), at: new Date().toISOString() }, ...list].slice(0, SMTP_ATTEMPTS_MAX));
}
