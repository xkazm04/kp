// At-rest sealing for the calendar credentials kp stores (calendar-secret.ts): the saved
// Google OAuth client secret and, on a keyless install, the grant tokens.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  calendarSecretKeyConfigured,
  decryptCalendarSecret,
  decryptCalendarSecretDetailed,
  encryptCalendarSecret,
} from "./calendar-secret.ts";

const KEYS = ["KP_CALENDAR_SECRET_KEY", "KP_SECRET", "KP_CALENDAR_SECRET_KEY_PREVIOUS", "KP_SECRET_PREVIOUS"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
function only(vars: Partial<Record<(typeof KEYS)[number], string>>): void {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vars);
}

const SECRET = "GOCSPX-plaintext-client-secret";

test("round-trips, and the stored form is ciphertext, never the plaintext", () => {
  only({ KP_CALENDAR_SECRET_KEY: "calendar-key-one" });
  const sealed = encryptCalendarSecret(SECRET);
  assert.match(sealed, /^v1:[^:]+:[^:]+:[^:]+$/);
  assert.equal(sealed.includes(SECRET), false);
  assert.equal(Buffer.from(sealed.split(":")[3], "base64").toString("utf8").includes(SECRET), false);
  assert.notEqual(encryptCalendarSecret(SECRET), sealed, "a fresh IV per seal");
  assert.equal(decryptCalendarSecret(sealed), SECRET);
});

test("the dedicated key wins over KP_SECRET, and KP_SECRET alone is enough", () => {
  only({ KP_SECRET: "session-secret" });
  assert.equal(calendarSecretKeyConfigured(), true);
  const underSession = encryptCalendarSecret(SECRET);
  only({ KP_CALENDAR_SECRET_KEY: "dedicated", KP_SECRET: "session-secret" });
  assert.throws(() => decryptCalendarSecret(underSession), "sealed under KP_SECRET, opened under the dedicated key: refused");
  assert.equal(decryptCalendarSecret(encryptCalendarSecret(SECRET)), SECRET);
});

test("no key: not configured, and sealing refuses without naming any value", () => {
  only({});
  assert.equal(calendarSecretKeyConfigured(), false);
  assert.throws(() => encryptCalendarSecret(SECRET), (err: Error) => /KP_CALENDAR_SECRET_KEY/.test(err.message) && !err.message.includes(SECRET));
});

test("rotation: a value sealed under the retired key still opens through _PREVIOUS", () => {
  only({ KP_CALENDAR_SECRET_KEY: "old-key" });
  const sealed = encryptCalendarSecret(SECRET);
  only({ KP_CALENDAR_SECRET_KEY: "new-key" });
  assert.throws(() => decryptCalendarSecret(sealed), "without the retired key it cannot open");
  only({ KP_CALENDAR_SECRET_KEY: "new-key", KP_CALENDAR_SECRET_KEY_PREVIOUS: "old-key" });
  assert.deepEqual(decryptCalendarSecretDetailed(sealed), { plaintext: SECRET, under: "previous" });
  const fresh = encryptCalendarSecret(SECRET);
  assert.deepEqual(decryptCalendarSecretDetailed(fresh), { plaintext: SECRET, under: "current" }, "new seals use the current key");
});

test("rotation falls back to KP_SECRET_PREVIOUS on a single-secret deployment", () => {
  only({ KP_SECRET: "old-session" });
  const sealed = encryptCalendarSecret(SECRET);
  only({ KP_SECRET: "new-session", KP_SECRET_PREVIOUS: "old-session" });
  assert.equal(decryptCalendarSecret(sealed), SECRET);
});

test("a tampered ciphertext is refused", () => {
  only({ KP_CALENDAR_SECRET_KEY: "k" });
  const [v, iv, tag, data] = encryptCalendarSecret(SECRET).split(":");
  const flipped = Buffer.from(data, "base64");
  flipped[0] ^= 1;
  assert.throws(() => decryptCalendarSecret([v, iv, tag, flipped.toString("base64")].join(":")));
  assert.throws(() => decryptCalendarSecret("not-a-ciphertext"));
});
