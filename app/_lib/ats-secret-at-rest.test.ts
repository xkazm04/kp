// #3 — the HMAC signing secret must be ENCRYPTED at rest so the whole-DB export
// (db-portability dumps every column verbatim) can never ship it in clear, and a raw
// DB read sees only ciphertext. Covers the ats-secret crypto contract AND the
// end-to-end property that setAtsConfig stores ciphertext while getAtsSecret still
// yields the plaintext to sign, and dumpWorkspace never contains the secret value.
//
// NON-VACUITY: pre-fix, webhook_secret was persisted PLAINTEXT, so the dump JSON
// contained the secret verbatim — `assert(!serialized.includes(SECRET))` fails
// against pre-fix code, and the stored column was the plaintext (not a "v1:" envelope).
//
// unit-db is the FIRST project import (points KP_DB_PATH at a throwaway file).
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { encryptAtsSecret, decryptAtsSecret, decryptAtsSecretDetailed, reencryptAtsSecret } from "./ats-secret.ts";
import { setAtsConfig, getAtsSecret, getAtsConfig } from "./ats-config-store.ts";
import { dumpWorkspace } from "./db-portability.ts";

const SECRET = "whsec-super-secret-hmac-value-123";

beforeEach(() => {
  process.env.KP_ATS_SECRET_KEY = "unit-test-ats-key";
  delete process.env.KP_SECRET;
  delete process.env.KP_ATS_SECRET_KEY_PREVIOUS;
  delete process.env.KP_SECRET_PREVIOUS;
});
after(() => cleanupUnitDb());

test("crypto: roundtrips under the key, hides the plaintext, fresh IV, tamper + missing-key rejected", () => {
  const ct = encryptAtsSecret(SECRET);
  assert.equal(ct.startsWith("v1:"), true);
  assert.equal(ct.includes(SECRET), false, "ciphertext must not contain the plaintext");
  assert.equal(decryptAtsSecret(ct), SECRET);
  assert.notEqual(encryptAtsSecret(SECRET), encryptAtsSecret(SECRET), "fresh IV per encryption");

  // A tampered ciphertext fails the GCM auth tag.
  const parts = ct.split(":");
  const data = Buffer.from(parts[3], "base64");
  data[0] ^= 0xff;
  parts[3] = data.toString("base64");
  assert.throws(() => decryptAtsSecret(parts.join(":")));

  // With no key at all, encryption refuses (never falls back to plaintext).
  delete process.env.KP_ATS_SECRET_KEY;
  delete process.env.KP_SECRET;
  assert.throws(() => encryptAtsSecret(SECRET), /KP_ATS_SECRET_KEY|KP_SECRET/);
});

test("setAtsConfig stores ciphertext; getAtsSecret decrypts; the DB export never contains the secret value", () => {
  setAtsConfig({ webhookUrl: "https://hooks.example.com/kp", webhookSecret: SECRET, events: ["candidate.hired"] });

  // The signer still gets the plaintext (signing keeps working).
  assert.equal(getAtsSecret(), SECRET);
  // The API/UI view exposes only hasSecret, never the value.
  const pub = getAtsConfig();
  assert.equal(pub.hasSecret, true);
  assert.equal(JSON.stringify(pub).includes(SECRET), false);

  // The whole-DB export dumps ats_config verbatim — it must carry ONLY ciphertext.
  const dump = dumpWorkspace(new Set()); // empty skip → include every table
  const serialized = JSON.stringify(dump);
  assert.equal(serialized.includes(SECRET), false, "the plaintext signing secret must never appear in an export artifact");

  const atsTable = dump.tables.find((t) => t.name === "ats_config");
  assert.ok(atsTable, "ats_config must be present in the dump");
  const secretCol = atsTable.columns.indexOf("webhook_secret");
  const storedValue = atsTable.rows[0][secretCol];
  assert.equal(
    typeof storedValue === "string" && storedValue.startsWith("v1:"),
    true,
    "the stored secret is a v1 ciphertext envelope, not plaintext"
  );
});

test("keep-existing (webhookSecret omitted) preserves the encrypted secret without re-plaintexting it", () => {
  setAtsConfig({ webhookUrl: "https://hooks.example.com/kp", webhookSecret: SECRET, events: ["candidate.hired"] });
  // A subsequent write that OMITS webhookSecret must keep the secret — and keep it
  // encrypted (never round-trip it back to plaintext through the decrypting reader).
  setAtsConfig({ webhookUrl: "https://hooks.example.com/kp2", events: ["candidate.hired", "candidate.rejected"] });
  assert.equal(getAtsSecret(), SECRET, "omitting webhookSecret keeps the secret");

  const dump = dumpWorkspace(new Set());
  assert.equal(JSON.stringify(dump).includes(SECRET), false, "still no plaintext after a keep-existing write");
});

test("clearing (webhookSecret: '') removes the secret", () => {
  setAtsConfig({ webhookUrl: "https://hooks.example.com/kp", webhookSecret: SECRET, events: [] });
  setAtsConfig({ webhookUrl: "https://hooks.example.com/kp", webhookSecret: "", events: [] });
  assert.equal(getAtsSecret(), null);
  assert.equal(getAtsConfig().hasSecret, false);
});

// ROTATION (/perfect wave 41, api-ats-integration). llm-secret.ts has read through a
// retired KP_SECRET_PREVIOUS since provider-key rotation shipped; this file did not, so
// rotating the key left every ATS token, webhook secret, edge key and calendar refresh
// token unreadable until `npm run secrets:rotate` had run — on a self-hosted install
// where the operator has just restarted with a new env, that is the whole integration
// surface dark with no recovery but re-entering the credentials by hand.
//
// NON-VACUITY: against pre-fix ats-secret.ts every assertion below throws
// "Unsupported state or unable to authenticate data" from the GCM tag — the retired key
// was never consulted, and decryptAtsSecretDetailed/reencryptAtsSecret did not exist.
test("rotation: a value sealed under the PREVIOUS key still decrypts, and re-encrypts under the current one", () => {
  process.env.KP_ATS_SECRET_KEY = "the-old-ats-key";
  const sealedUnderOld = encryptAtsSecret(SECRET);

  // The rotation: a new current key, the retired one declared alongside it.
  process.env.KP_ATS_SECRET_KEY = "the-new-ats-key";
  process.env.KP_ATS_SECRET_KEY_PREVIOUS = "the-old-ats-key";

  assert.equal(decryptAtsSecret(sealedUnderOld), SECRET, "a rotated deployment stays readable");
  assert.equal(decryptAtsSecretDetailed(sealedUnderOld).under, "previous", "and it says WHICH key opened it");

  const healed = reencryptAtsSecret(sealedUnderOld);
  assert.equal(healed.changed, true, "the row is rewritten under the current key");
  assert.notEqual(healed.ciphertext, sealedUnderOld);

  // Re-sealed: the current key alone now opens it, so KP_ATS_SECRET_KEY_PREVIOUS can go.
  delete process.env.KP_ATS_SECRET_KEY_PREVIOUS;
  assert.equal(decryptAtsSecret(healed.ciphertext), SECRET);
  assert.equal(reencryptAtsSecret(healed.ciphertext).changed, false, "re-running the heal is a no-op");
});

test("rotation: the single-secret deployment rotates through KP_SECRET_PREVIOUS", () => {
  // No dedicated key set — the same fallback chain the CURRENT key already uses.
  delete process.env.KP_ATS_SECRET_KEY;
  process.env.KP_SECRET = "old-master-secret";
  const sealed = encryptAtsSecret(SECRET);
  process.env.KP_SECRET = "new-master-secret";
  process.env.KP_SECRET_PREVIOUS = "old-master-secret";
  assert.equal(decryptAtsSecret(sealed), SECRET);
});

test("rotation: a value NEITHER key opens reports the current key's failure, never a wrong plaintext", () => {
  process.env.KP_ATS_SECRET_KEY = "the-real-key";
  const sealed = encryptAtsSecret(SECRET);
  process.env.KP_ATS_SECRET_KEY = "a-third-key";
  process.env.KP_ATS_SECRET_KEY_PREVIOUS = "another-wrong-key";
  assert.throws(() => decryptAtsSecret(sealed));
  // reencrypt must NOT rewrite a row it cannot read — that would destroy the only copy.
  assert.throws(() => reencryptAtsSecret(sealed));
});
