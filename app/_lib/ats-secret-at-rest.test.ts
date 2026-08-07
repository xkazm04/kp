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
import { encryptAtsSecret, decryptAtsSecret } from "./ats-secret.ts";
import { setAtsConfig, getAtsSecret, getAtsConfig } from "./ats-config-store.ts";
import { dumpWorkspace } from "./db-portability.ts";

const SECRET = "whsec-super-secret-hmac-value-123";

beforeEach(() => {
  process.env.KP_ATS_SECRET_KEY = "unit-test-ats-key";
  delete process.env.KP_SECRET;
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
