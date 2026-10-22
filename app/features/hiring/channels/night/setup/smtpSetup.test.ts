import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canSaveSmtp,
  parseSmtpBody,
  smtpDirty,
  smtpFormFrom,
  smtpPasswordRequired,
  smtpSaveBody,
  smtpStageLabel,
  smtpTestGate,
  smtpTestOutcome,
  type SmtpState,
} from "./smtpSetup.ts";

const STORED = parseSmtpBody({
  config: { preset: "seznam", host: "smtp.seznam.cz", port: 465, security: "tls", address: "owner@seznam.cz", fromName: null, hasPassword: true, version: 3, attempts: [{ at: "x", kind: "test", to: "owner@seznam.cz", outcome: "sent", stage: null, code: 250, text: "ok" }, { bogus: 1 }], suppressed: [] },
  smtp: "configured",
  active: "smtp",
}) as SmtpState;

test("the read: null while unknown, the health and the active transport carried", () => {
  assert.equal(parseSmtpBody(null), null);
  assert.equal(parseSmtpBody({ error: "x" }), null);
  assert.equal(STORED.health, "configured");
  assert.equal(STORED.active, "smtp");
  assert.equal(STORED.attempts.length, 1, "a malformed attempt row is dropped");
  assert.equal(parseSmtpBody({ config: {}, smtp: "weird", active: "weird" })?.health, "unconfigured");
});

test("a preset save sends no server fields; a typed password only when typed; the read version", () => {
  const form = { ...smtpFormFrom(STORED), address: "owner@seznam.cz" };
  assert.deepEqual(smtpSaveBody(STORED, form), { preset: "seznam", address: "owner@seznam.cz", fromName: "", expectedVersion: 3 });
  const custom = { ...form, preset: "custom" as const, host: "mail.acme.cz", port: "587", security: "starttls" as const, password: "pw" };
  assert.deepEqual(smtpSaveBody(null, custom), { preset: "custom", address: "owner@seznam.cz", fromName: "", password: "pw", host: "mail.acme.cz", port: 587, security: "starttls" });
});

test("dirty and save gates", () => {
  const form = smtpFormFrom(STORED);
  assert.equal(smtpDirty(STORED, form), false);
  assert.equal(smtpDirty(STORED, { ...form, password: "x" }), true);
  assert.equal(smtpDirty(STORED, { ...form, preset: "gmail" }), true);
  assert.equal(canSaveSmtp(STORED, form, false), true, "a stored password is enough");
  assert.equal(canSaveSmtp(null, { ...smtpFormFrom(null), address: "a@b.cz" }, false), false, "a first save needs a password");
  assert.equal(canSaveSmtp(null, { ...smtpFormFrom(null), address: "a@b.cz", password: "p" }, false), true);
  assert.equal(canSaveSmtp(STORED, { ...form, preset: "custom", host: "" }, false), false);
  assert.equal(canSaveSmtp(STORED, form, true), false);
});

test("a new server or login needs the password typed again; a new display name does not", () => {
  const form = smtpFormFrom(STORED);
  assert.equal(smtpPasswordRequired(STORED, form), false);
  assert.equal(canSaveSmtp(STORED, { ...form, fromName: "Acme", address: "Owner@Seznam.cz" }, false), true, "same server, same login");
  const moved = [
    { ...form, preset: "gmail" as const },
    { ...form, address: "someone@seznam.cz" },
    { ...form, preset: "custom" as const, host: "smtp.attacker.example", port: "465", security: "tls" as const },
  ];
  for (const f of moved) {
    assert.equal(smtpPasswordRequired(STORED, f), true, JSON.stringify(f));
    assert.equal(canSaveSmtp(STORED, f, false), false, "the stored password is not offered to another server");
    assert.equal(canSaveSmtp(STORED, { ...f, password: "typed" }, false), true);
  }
  const custom = parseSmtpBody({ config: { ...STORED, preset: "custom", host: "mail.acme.cz", port: 587, security: "starttls" }, smtp: "configured" }) as SmtpState;
  const cf = smtpFormFrom(custom);
  assert.equal(smtpPasswordRequired(custom, { ...cf, port: "465", security: "tls" }), false, "port and mode stay on the same host");
  assert.equal(smtpPasswordRequired(custom, { ...cf, host: "MAIL.acme.cz" }), false);
  assert.equal(smtpPasswordRequired(custom, { ...cf, host: "mail.other.cz" }), true);
});

test("the test gate: only a configured, saved, readable sender is tested", () => {
  assert.equal(smtpTestGate(STORED, false, false), "ok");
  assert.equal(smtpTestGate(STORED, true, false), "unsaved");
  assert.equal(smtpTestGate({ ...STORED, health: "unreadable" }, false, false), "unreadable");
  assert.equal(smtpTestGate({ ...STORED, health: "unconfigured" }, false, false), "noSender");
  assert.equal(smtpTestGate(null, false, false), "noSender");
  assert.equal(smtpTestGate(STORED, false, true), "busy");
});

test("the test answer: sent only on ok; the code and stage of a failure; refusals by code", () => {
  assert.deepEqual(smtpTestOutcome({ ok: true, to: "o@s.cz", code: 250, text: "OK" }), { kind: "sent", to: "o@s.cz", code: 250 });
  assert.deepEqual(smtpTestOutcome({ ok: false, to: "o@s.cz", stage: "auth", code: 535, text: "bad" }), { kind: "failed", to: "o@s.cz", stage: "auth", code: 535, text: "bad" });
  assert.deepEqual(smtpTestOutcome({ ok: false, sealed: true, reason: "sealed" }), { kind: "sealed" });
  assert.deepEqual(smtpTestOutcome({ ok: false, reason: "unreadable" }), { kind: "unreadable" });
  assert.deepEqual(smtpTestOutcome({ code: "TOO_MANY_REQUESTS" }, 429), { kind: "refused", body: { code: "TOO_MANY_REQUESTS" }, status: 429 });
  assert.equal(smtpTestOutcome(null).kind, "failed");
  assert.equal(smtpStageLabel("rcpt"), "RCPT TO");
});
