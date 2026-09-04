// What the relay store puts ON DISK.
//
// The signing secret lets its holder forge `x-kp-signature` on every candidate
// message, and db-portability dumps every column verbatim — so the row must never
// hold plaintext, and the whole-DB export must never carry a readable secret. That
// property had no test at all: relay-version.test.ts pins the concurrency contract
// through the PUBLIC view, which by doctrine shows `hasSecret` and never the value,
// so nothing looked at the bytes. Everything below reads the raw row on a second
// connection, the way an exporter (or an attacker with the file) would.
//
// NON-VACUITY: store the secret as given and `encrypted at rest` fails on the first
// assertion; drop the version re-check and `a refused write does not touch the
// stored ciphertext` fails.
//
// unit-db is the FIRST project import (it points KP_DB_PATH at a throwaway file).
import "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import {
  CommsRelaySecretError,
  CommsRelayStaleError,
  getRelayConfig,
  getRelaySecret,
  setRelayConfig,
} from "./comms-relay-store.ts";

process.env.KP_ATS_SECRET_KEY = "unit-test-relay-key";

after(() => cleanupUnitDb());

/** The stored column, read the way a DB export or a stolen file would read it —
 *  a SECOND connection, no store code in the way. */
function rawSecret(): string | null {
  const db = new Database(process.env.KP_DB_PATH as string, { readonly: true });
  try {
    const row = db.prepare(`SELECT relay_secret FROM comms_relay_config WHERE id = 1`).get() as
      | { relay_secret: string | null }
      | undefined;
    return row?.relay_secret ?? null;
  } finally {
    db.close();
  }
}

function writeRawSecret(value: string): void {
  const db = new Database(process.env.KP_DB_PATH as string);
  try {
    db.prepare(`UPDATE comms_relay_config SET relay_secret = ? WHERE id = 1`).run(value);
  } finally {
    db.close();
  }
}

test("the signing secret is encrypted at rest — the row never holds the plaintext", () => {
  setRelayConfig({ url: "https://relay.example/hook", secret: "topsecret-signing-key" });
  const stored = rawSecret();
  assert.ok(stored, "a secret was saved");
  assert.notEqual(stored, "topsecret-signing-key", "the plaintext must not be on disk");
  assert.equal(stored.includes("topsecret-signing-key"), false, "…not even as a substring");
  assert.match(stored, /^v1:[^:]+:[^:]+:.+$/, "the ats-secret envelope: v1:<iv>:<tag>:<data>");
  // …and it round-trips for the sender.
  assert.equal(getRelaySecret(), "topsecret-signing-key");
  // Two writes of the SAME secret produce different ciphertext (fresh IV): a
  // deterministic envelope would leak "these two installs share a secret".
  const first = rawSecret();
  setRelayConfig({ url: "https://relay.example/hook", secret: "topsecret-signing-key" });
  assert.notEqual(rawSecret(), first, "each write mints a fresh IV");
  assert.equal(getRelaySecret(), "topsecret-signing-key");
});

test("a secret written before at-rest encryption existed is still readable, and is re-encrypted when it is next SET", () => {
  writeRawSecret("legacy-plaintext-secret");
  assert.equal(rawSecret(), "legacy-plaintext-secret", "the fixture is a genuine legacy row");
  // Tolerated: an upgrade must not silently stop signing.
  assert.equal(getRelaySecret(), "legacy-plaintext-secret");
  assert.equal(getRelayConfig().hasSecret, true);
  // A url-only write carries the stored value through untouched (the omitted-secret
  // leg is "keep", not "re-key") — the plaintext survives until the secret is re-entered.
  setRelayConfig({ url: "https://relay.example/moved" });
  assert.equal(rawSecret(), "legacy-plaintext-secret", "an omitted secret is kept verbatim");
  // Re-entering it is what retires the plaintext.
  setRelayConfig({ url: "https://relay.example/moved", secret: "legacy-plaintext-secret" });
  assert.match(rawSecret() ?? "", /^v1:/, "the same value, now enveloped");
  assert.equal(getRelaySecret(), "legacy-plaintext-secret");
});

test("a secret this deployment cannot decrypt is OUR error, naming the failure", () => {
  setRelayConfig({ url: "https://relay.example/hook", secret: "still-readable" });
  process.env.KP_ATS_SECRET_KEY = "some-other-deployment-secret";
  try {
    assert.throws(
      () => getRelaySecret(),
      (e: unknown) => e instanceof CommsRelaySecretError && /decrypt/i.test((e as Error).message)
    );
    // The public view is unaffected: a secret IS stored, we just cannot read it —
    // that difference is what comms-relay.relayHealth() turns into "unreadable".
    assert.equal(getRelayConfig().hasSecret, true);
  } finally {
    process.env.KP_ATS_SECRET_KEY = "unit-test-relay-key";
  }
  assert.equal(getRelaySecret(), "still-readable", "…and the right key still opens it");
});

test("a refused (stale) write does not touch the stored ciphertext", () => {
  setRelayConfig({ url: "https://relay.example/live", secret: "keep-me" });
  const before = rawSecret();
  const version = getRelayConfig().version;
  assert.throws(
    () => setRelayConfig({ url: "https://relay.example/clobber", secret: "overwrite-me", expectedVersion: version - 1 }),
    CommsRelayStaleError
  );
  assert.equal(rawSecret(), before, "the losing write must not have re-keyed the row");
  assert.equal(getRelaySecret(), "keep-me");
  assert.equal(getRelayConfig().version, version, "a refused write does not bump the version");
});
