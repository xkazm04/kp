// The calendar key made available without a restart (calendar-key.ts): generated once into
// .env.local, never overwriting a value, never touching KP_SECRET, and never changing the
// auth posture of the install it runs on.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureCalendarSecretKey } from "./calendar-key.ts";
import { isOpenMode } from "../auth/open-entry.ts";
import { signSession, verifySession } from "../auth/session.ts";

const dir = mkdtempSync(path.join(tmpdir(), "kp-calendar-key-"));
after(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
const fileWith = (content: string | null): string => {
  const f = path.join(dir, `env-${++n}.local`);
  if (content !== null) writeFileSync(f, content);
  return f;
};

test("keyless: generates a strong key, persists it to the file and sets it in the process env", () => {
  const env: Record<string, string | undefined> = {};
  const file = fileWith("EXISTING=1\n");
  const out = ensureCalendarSecretKey({ env, envFile: file });
  assert.deepEqual(out, { ok: true, source: "generated" });
  const key = env.KP_CALENDAR_SECRET_KEY ?? "";
  assert.ok(key.length >= 43, "32 random bytes, base64url");
  const text = readFileSync(file, "utf8");
  assert.ok(text.startsWith("EXISTING=1\n"), "what was there stays");
  assert.ok(text.includes(`KP_CALENDAR_SECRET_KEY=${key}\n`));
  assert.equal(/^KP_SECRET=/m.test(text), false, "KP_SECRET is never written");
  assert.equal(env.KP_SECRET, undefined);
});

test("creates the file when there is none", () => {
  const env: Record<string, string | undefined> = {};
  const file = fileWith(null);
  assert.equal(ensureCalendarSecretKey({ env, envFile: file }).ok, true);
  assert.ok(readFileSync(file, "utf8").includes(`KP_CALENDAR_SECRET_KEY=${env.KP_CALENDAR_SECRET_KEY}`));
});

test("never overwrites: a value already in the file is ADOPTED, the file is untouched", () => {
  const env: Record<string, string | undefined> = {};
  const before = 'A=1\nKP_CALENDAR_SECRET_KEY="kept-value"\n';
  const file = fileWith(before);
  assert.deepEqual(ensureCalendarSecretKey({ env, envFile: file, generate: () => "SHOULD-NOT-APPEAR" }), { ok: true, source: "file" });
  assert.equal(env.KP_CALENDAR_SECRET_KEY, "kept-value");
  assert.equal(readFileSync(file, "utf8"), before);
});

test("a second call is a no-op: the key set in the process is reused", () => {
  const env: Record<string, string | undefined> = {};
  const file = fileWith("");
  ensureCalendarSecretKey({ env, envFile: file });
  const first = readFileSync(file, "utf8");
  assert.deepEqual(ensureCalendarSecretKey({ env, envFile: file }), { ok: true, source: "env" });
  assert.equal(readFileSync(file, "utf8"), first);
});

test("an empty placeholder line is filled in place, not duplicated", () => {
  const env: Record<string, string | undefined> = {};
  const file = fileWith("A=1\r\nKP_CALENDAR_SECRET_KEY=\r\nB=2\r\n");
  ensureCalendarSecretKey({ env, envFile: file, generate: () => "generated-key" });
  assert.equal(readFileSync(file, "utf8"), "A=1\r\nKP_CALENDAR_SECRET_KEY=generated-key\r\nB=2\r\n");
});

test("KP_SECRET set: nothing is generated, the file and KP_SECRET are untouched", () => {
  const env: Record<string, string | undefined> = { KP_SECRET: "session-secret" };
  const file = fileWith("A=1\n");
  assert.deepEqual(ensureCalendarSecretKey({ env, envFile: file }), { ok: true, source: "env" });
  assert.equal(env.KP_SECRET, "session-secret");
  assert.equal(env.KP_CALENDAR_SECRET_KEY, undefined);
  assert.equal(readFileSync(file, "utf8"), "A=1\n");
});

test("a key that cannot be persisted is not set at all", () => {
  const env: Record<string, string | undefined> = {};
  const file = path.join(dir, "no-such-dir", "nested", ".env.local");
  assert.deepEqual(ensureCalendarSecretKey({ env, envFile: file }), { ok: false, reason: "persist_failed" });
  assert.equal(env.KP_CALENDAR_SECRET_KEY, undefined);
  assert.equal(existsSync(file), false);
});

test("auth posture is unchanged by generating the key (open mode, no session secret)", () => {
  const saved = { secret: process.env.KP_SECRET, password: process.env.KP_OPERATOR_PASSWORD, cal: process.env.KP_CALENDAR_SECRET_KEY };
  delete process.env.KP_SECRET;
  delete process.env.KP_OPERATOR_PASSWORD;
  delete process.env.KP_CALENDAR_SECRET_KEY;
  try {
    const openBefore = isOpenMode();
    const signBefore = (() => {
      try {
        signSession();
        return "signed";
      } catch {
        return "refused";
      }
    })();
    assert.equal(ensureCalendarSecretKey({ envFile: fileWith("") }).ok, true);
    assert.ok(process.env.KP_CALENDAR_SECRET_KEY, "the key is live in this process");
    assert.equal(process.env.KP_SECRET, undefined, "KP_SECRET is not created");
    assert.equal(isOpenMode(), openBefore, "open mode stays open mode");
    const signAfter = (() => {
      try {
        signSession();
        return "signed";
      } catch {
        return "refused";
      }
    })();
    assert.equal(signAfter, signBefore, "session signing behaves exactly as before");
  } finally {
    for (const [k, v] of [["KP_SECRET", saved.secret], ["KP_OPERATOR_PASSWORD", saved.password], ["KP_CALENDAR_SECRET_KEY", saved.cal]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("auth posture is unchanged with a password + KP_SECRET: an existing session still verifies", () => {
  const saved = { secret: process.env.KP_SECRET, password: process.env.KP_OPERATOR_PASSWORD, cal: process.env.KP_CALENDAR_SECRET_KEY };
  process.env.KP_SECRET = "auth-posture-session-secret";
  process.env.KP_OPERATOR_PASSWORD = "auth-posture-password";
  delete process.env.KP_CALENDAR_SECRET_KEY;
  try {
    const token = signSession();
    const file = fileWith("A=1\n");
    assert.deepEqual(ensureCalendarSecretKey({ envFile: file }), { ok: true, source: "env" });
    assert.equal(process.env.KP_SECRET, "auth-posture-session-secret");
    assert.equal(isOpenMode(), false);
    assert.ok(verifySession(token), "the owner is not locked out");
    assert.equal(readFileSync(file, "utf8"), "A=1\n");
  } finally {
    for (const [k, v] of [["KP_SECRET", saved.secret], ["KP_OPERATOR_PASSWORD", saved.password], ["KP_CALENDAR_SECRET_KEY", saved.cal]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
