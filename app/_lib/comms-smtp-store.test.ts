// What the SMTP store puts ON DISK and what it lets out.
//
// The mailbox password sends mail as the owner, and db-portability dumps every column
// verbatim, so the row must never hold plaintext. The public view, every error message
// and every log line the store, the resolver and the save door produce must never carry
// it either. Read on a SECOND connection, the way an exporter or a stolen file would.
//
// NON-VACUITY: store the password as given and "encrypted at rest" fails on its first
// assertion; drop the version re-check and "a stale write is refused" fails.
//
// unit-db is the FIRST project import (it points KP_DB_PATH at a throwaway file).
import "./testing/unit-db.ts";
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import {
  CommsSmtpError,
  CommsSmtpSecretError,
  CommsSmtpStaleError,
  getSmtpConfig,
  getSmtpPrivateConfig,
  setSmtpConfig,
  smtpConfigured,
  smtpSuppressionFor,
  suppressSmtpAddress,
  unsuppressSmtpAddress,
  recordSmtpAttempt,
  SMTP_ATTEMPTS_MAX,
} from "./comms-smtp-store.ts";
import { isRelayConfigured, resolveTransport, smtpHealth } from "./comms-relay.ts";

const PASSWORD = "abcd efgh ijkl mnop-app-password";
process.env.KP_ATS_SECRET_KEY = "unit-test-smtp-key";

after(() => cleanupUnitDb());
afterEach(() => {
  process.env.KP_ATS_SECRET_KEY = "unit-test-smtp-key";
  delete process.env.COMMS_WEBHOOK_URL;
  delete process.env.KP_NO_COMMS_EGRESS;
});

function rawRow(): Record<string, unknown> | undefined {
  const db = new Database(process.env.KP_DB_PATH as string, { readonly: true });
  try {
    return db.prepare(`SELECT * FROM comms_smtp_config WHERE id = 1`).get() as Record<string, unknown> | undefined;
  } finally {
    db.close();
  }
}

/** Run fn and return everything written to the console meanwhile. */
async function captureConsole(fn: () => unknown | Promise<unknown>): Promise<string> {
  const out: string[] = [];
  const saved = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  const grab = (...args: unknown[]) => {
    out.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  console.log = console.error = console.warn = console.info = grab;
  try {
    await fn();
  } catch (e) {
    out.push(e instanceof Error ? e.message : String(e));
  } finally {
    Object.assign(console, saved);
  }
  return out.join("\n");
}

test("unset: nothing is configured and the transport is exactly what it was (none)", () => {
  assert.equal(smtpConfigured(), false);
  assert.equal(smtpHealth(), "unconfigured");
  assert.equal(resolveTransport().kind, "none");
  assert.equal(isRelayConfigured(), false);
});

test("a preset fills host, port and security; the user types only address and password", () => {
  const saved = setSmtpConfig({ preset: "gmail", address: "owner@gmail.com", password: PASSWORD, host: "evil.internal", port: 25 });
  assert.equal(saved.host, "smtp.gmail.com");
  assert.equal(saved.port, 465);
  assert.equal(saved.security, "tls");
  assert.equal(saved.hasPassword, true);
  assert.equal(JSON.stringify(saved).includes(PASSWORD), false, "the public view never carries the password");
  const o365 = setSmtpConfig({ preset: "office365", address: "owner@contoso.com" });
  assert.deepEqual([o365.host, o365.port, o365.security, o365.hasPassword], ["smtp.office365.com", 587, "starttls", true]);
  const seznam = setSmtpConfig({ preset: "seznam", address: "owner@seznam.cz" });
  assert.deepEqual([seznam.host, seznam.port, seznam.security], ["smtp.seznam.cz", 465, "tls"]);
});

test("the password is encrypted at rest and decrypts for the send path only", () => {
  setSmtpConfig({ preset: "seznam", address: "owner@seznam.cz", password: PASSWORD });
  const row = rawRow();
  assert.ok(row?.password);
  assert.notEqual(row?.password, PASSWORD);
  assert.equal(JSON.stringify(row).includes(PASSWORD), false, "no column holds the plaintext");
  assert.match(String(row?.password), /^v1:/);
  assert.equal(getSmtpPrivateConfig()?.password, PASSWORD);
  assert.equal(resolveTransport().kind, "smtp");
  assert.equal(isRelayConfigured(), true, "an SMTP sender is a sender: letters are no longer only queued");
});

test("the relay keeps precedence when both are configured", () => {
  setSmtpConfig({ preset: "seznam", address: "owner@seznam.cz", password: PASSWORD });
  process.env.COMMS_WEBHOOK_URL = "https://relay.example.test/hook";
  assert.equal(resolveTransport().kind, "relay");
});

test("the egress seal answers no sender for SMTP too", () => {
  setSmtpConfig({ preset: "seznam", address: "owner@seznam.cz", password: PASSWORD });
  process.env.KP_NO_COMMS_EGRESS = "1";
  assert.equal(resolveTransport().kind, "none");
  assert.equal(isRelayConfigured(), false);
});

test("an undecryptable password reads 'unreadable', not 'not configured', and the log never shows it", async () => {
  setSmtpConfig({ preset: "seznam", address: "owner@seznam.cz", password: PASSWORD });
  process.env.KP_ATS_SECRET_KEY = "a-rotated-key";
  assert.throws(() => getSmtpPrivateConfig(), (e: unknown) => e instanceof CommsSmtpSecretError && !e.message.includes(PASSWORD));
  const logged = await captureConsole(() => {
    assert.equal(smtpHealth(), "unreadable");
    assert.equal(resolveTransport().kind, "none");
  });
  assert.match(logged, /cannot be decrypted/);
  assert.equal(logged.includes(PASSWORD), false);
  assert.equal(getSmtpConfig().hasPassword, true);
});

test("never logged: a save, a refused save and a stale save print nothing that holds the password", async () => {
  const logged = await captureConsole(() => {
    const v = setSmtpConfig({ preset: "gmail", address: "owner@gmail.com", password: PASSWORD }).version;
    assert.throws(() => setSmtpConfig({ preset: "nope", address: "owner@gmail.com", password: PASSWORD }), (e: unknown) => e instanceof CommsSmtpError && !e.message.includes(PASSWORD));
    assert.throws(() => setSmtpConfig({ preset: "custom", address: "owner@gmail.com", host: "mail.example.com", port: 25, security: "none", password: PASSWORD }), (e: unknown) => e instanceof CommsSmtpError && !e.message.includes(PASSWORD));
    assert.throws(() => setSmtpConfig({ preset: "gmail", address: "owner@gmail.com", password: PASSWORD, expectedVersion: v - 1 }), (e: unknown) => e instanceof CommsSmtpStaleError && !e.message.includes(PASSWORD));
    delete process.env.KP_ATS_SECRET_KEY;
    delete process.env.KP_SECRET;
    assert.throws(() => setSmtpConfig({ preset: "gmail", address: "owner@gmail.com", password: PASSWORD }), (e: unknown) => e instanceof CommsSmtpError && !e.message.includes(PASSWORD));
  });
  assert.equal(logged.includes(PASSWORD), false);
});

test("a stale write is refused and changes nothing; an omitted password is kept", () => {
  const live = setSmtpConfig({ preset: "gmail", address: "owner@gmail.com", password: PASSWORD });
  assert.throws(() => setSmtpConfig({ preset: "seznam", address: "x@seznam.cz", expectedVersion: live.version - 1 }), CommsSmtpStaleError);
  const after = getSmtpConfig();
  assert.equal(after.address, "owner@gmail.com");
  assert.equal(after.version, live.version);
  const next = setSmtpConfig({ preset: "gmail", address: "owner@gmail.com", fromName: "Acme Hiring", expectedVersion: live.version });
  assert.equal(next.hasPassword, true);
  assert.equal(next.version, live.version + 1);
});

test("custom refuses a plain-text mode and a bad host or port", () => {
  assert.throws(() => setSmtpConfig({ preset: "custom", address: "a@b.cz", host: "mail.b.cz", port: 587, security: "none" }), CommsSmtpError);
  assert.throws(() => setSmtpConfig({ preset: "custom", address: "a@b.cz", host: "mail b", port: 587, security: "starttls" }), CommsSmtpError);
  assert.throws(() => setSmtpConfig({ preset: "custom", address: "a@b.cz", host: "mail.b.cz", port: 0, security: "starttls" }), CommsSmtpError);
  assert.throws(() => setSmtpConfig({ preset: "gmail", address: "not an address" }), CommsSmtpError);
  const ok = setSmtpConfig({ preset: "custom", address: "a@b.cz", host: "Mail.B.cz", port: 587, security: "starttls" });
  assert.deepEqual([ok.host, ok.port, ok.security], ["mail.b.cz", 587, "starttls"]);
});

test("suppression list: normalized, kept across saves, removable; attempts are bounded", () => {
  setSmtpConfig({ preset: "gmail", address: "owner@gmail.com", password: PASSWORD });
  suppressSmtpAddress("Jana@Example.cz", 550, "5.1.1 User unknown");
  assert.equal(smtpSuppressionFor("jana@example.cz")?.code, 550);
  setSmtpConfig({ preset: "seznam", address: "owner@seznam.cz" });
  assert.ok(smtpSuppressionFor("JANA@example.cz"), "a save keeps the list");
  assert.equal(unsuppressSmtpAddress("jana@example.cz"), true);
  assert.equal(smtpSuppressionFor("jana@example.cz"), null);
  for (let i = 0; i < SMTP_ATTEMPTS_MAX + 5; i++) {
    recordSmtpAttempt({ kind: "test", to: "owner@seznam.cz", messageId: `m${i}`, outcome: "sent", stage: null, code: 250, text: "ok" });
  }
  const attempts = getSmtpConfig().attempts;
  assert.equal(attempts.length, SMTP_ATTEMPTS_MAX);
  assert.equal(attempts[0].messageId, `m${SMTP_ATTEMPTS_MAX + 4}`, "newest first");
});
