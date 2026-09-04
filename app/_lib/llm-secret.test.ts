// At-rest encryption contract for UI-entered provider keys: roundtrip under
// KP_SECRET, tamper rejection via the GCM auth tag, and the refuse-to-store
// guard when no master secret is configured.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  decryptProviderSecret,
  decryptProviderSecretDetailed,
  encryptProviderSecret,
  isProviderSecretCiphertext,
  reencryptProviderSecret,
} from "./llm-secret.ts";
import { rotateDatabaseSecrets, type RotateColumnResult } from "../../scripts/secrets-rotate.mjs";

/** The stats for one table, asserted to exist — a rotation that silently skipped the
 *  table under test would otherwise pass every count assertion below. */
function statsFor(results: RotateColumnResult[], table: string): RotateColumnResult {
  const found = results.find((r) => r.table === table);
  assert.ok(found, `no rotation result for ${table}`);
  return found;
}

beforeEach(() => {
  process.env.KP_SECRET = "test-master-secret";
  delete process.env.KP_SECRET_PREVIOUS;
});

test("roundtrips a provider key", () => {
  const ciphertext = encryptProviderSecret("sk-ant-byom-12345");
  assert.equal(ciphertext.includes("sk-ant-byom"), false);
  assert.equal(decryptProviderSecret(ciphertext), "sk-ant-byom-12345");
});

test("each encryption uses a fresh IV", () => {
  assert.notEqual(encryptProviderSecret("same"), encryptProviderSecret("same"));
});

test("a changed KP_SECRET fails the auth tag instead of decrypting garbage", () => {
  const ciphertext = encryptProviderSecret("sk-test");
  process.env.KP_SECRET = "rotated-secret";
  assert.throws(() => decryptProviderSecret(ciphertext));
});

test("tampered ciphertext is rejected", () => {
  const ciphertext = encryptProviderSecret("sk-test");
  const parts = ciphertext.split(":");
  const data = Buffer.from(parts[3], "base64");
  data[0] ^= 0xff;
  parts[3] = data.toString("base64");
  assert.throws(() => decryptProviderSecret(parts.join(":")));
});

test("unknown format is rejected up front", () => {
  assert.throws(() => decryptProviderSecret("plaintext-not-ciphertext"), /format/);
});

test("missing KP_SECRET refuses to encrypt", () => {
  delete process.env.KP_SECRET;
  assert.throws(() => encryptProviderSecret("sk-test"), /KP_SECRET/);
});

// --- Rotation ---------------------------------------------------------------
// Changing KP_SECRET used to brick every stored provider key at once. The
// KP_SECRET_PREVIOUS fallback keeps a rotated deployment READABLE, and
// `npm run secrets:rotate` makes that state temporary rather than permanent.

test("KP_SECRET_PREVIOUS decrypts a key written under the retired secret", () => {
  const ciphertext = encryptProviderSecret("sk-written-before-rotation");
  process.env.KP_SECRET_PREVIOUS = "test-master-secret";
  process.env.KP_SECRET = "the-new-master-secret";
  assert.equal(decryptProviderSecret(ciphertext), "sk-written-before-rotation");
  assert.equal(decryptProviderSecretDetailed(ciphertext).under, "previous");
});

test("new ciphertext is always written under the CURRENT secret", () => {
  process.env.KP_SECRET_PREVIOUS = "test-master-secret";
  process.env.KP_SECRET = "the-new-master-secret";
  const fresh = encryptProviderSecret("sk-written-after-rotation");
  assert.equal(decryptProviderSecretDetailed(fresh).under, "current");
  // …and it is unreadable once the deployment has finished rotating and dropped
  // the retired secret only if it was written under the OLD one — this one is not.
  delete process.env.KP_SECRET_PREVIOUS;
  assert.equal(decryptProviderSecret(fresh), "sk-written-after-rotation");
});

test("a value neither secret opens still reports the current key's failure", () => {
  const ciphertext = encryptProviderSecret("sk-test");
  process.env.KP_SECRET = "some-third-secret";
  process.env.KP_SECRET_PREVIOUS = "and-a-fourth";
  assert.throws(() => decryptProviderSecret(ciphertext));
});

test("re-encryption rewrites a previous-secret value and leaves a current one alone", () => {
  const old = encryptProviderSecret("sk-rotate-me");
  process.env.KP_SECRET_PREVIOUS = "test-master-secret";
  process.env.KP_SECRET = "the-new-master-secret";
  const rotated = reencryptProviderSecret(old);
  assert.equal(rotated.changed, true);
  assert.notEqual(rotated.ciphertext, old);
  assert.equal(decryptProviderSecretDetailed(rotated.ciphertext).under, "current");
  // Idempotent: a second pass over the same row is a no-op, so an interrupted
  // rotation can simply be run again.
  assert.deepEqual(reencryptProviderSecret(rotated.ciphertext), { ciphertext: rotated.ciphertext, changed: false });
});

test("only our envelope is treated as ciphertext", () => {
  assert.equal(isProviderSecretCiphertext(encryptProviderSecret("sk-test")), true);
  assert.equal(isProviderSecretCiphertext("sk-legacy-plaintext"), false);
  assert.equal(isProviderSecretCiphertext(""), false);
});

test("the rotate script keeps every stored key readable under the new secret alone", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kp-rotate-"));
  const db = new Database(path.join(dir, "rotate.sqlite"));
  try {
    db.exec(`CREATE TABLE provider_keys (provider TEXT, scope TEXT, key_ciphertext TEXT)`);
    const insert = db.prepare(`INSERT INTO provider_keys VALUES (?, ?, ?)`);
    insert.run("openai", "byom", encryptProviderSecret("sk-openai-byom"));
    insert.run("gemini", "byom", encryptProviderSecret("gm-key"));
    // A legacy plaintext row and a NULL must survive the walk untouched.
    insert.run("ollama", "byom", "not-encrypted-at-all");
    insert.run("qwen", "byom", null);

    process.env.KP_SECRET_PREVIOUS = "test-master-secret";
    process.env.KP_SECRET = "the-new-master-secret";

    // A dry run reports the work without doing it…
    const dry = statsFor(rotateDatabaseSecrets(db, { dryRun: true, env: {} }).results, "provider_keys");
    assert.equal(dry.rewritten, 2);
    assert.equal(dry.skipped, 2, "plaintext + NULL rows are skipped, never rewritten");
    assert.equal(dry.unreadable, 0);

    const { results } = rotateDatabaseSecrets(db, { env: {} });
    assert.equal(statsFor(results, "provider_keys").rewritten, 2);

    // The whole point: with the retired secret GONE, the keys still read back.
    delete process.env.KP_SECRET_PREVIOUS;
    const rows = db
      .prepare(`SELECT provider, key_ciphertext AS c FROM provider_keys ORDER BY provider`)
      .all() as Array<{ provider: string; c: string | null }>;
    const byProvider = Object.fromEntries(rows.map((r) => [r.provider, r.c]));
    assert.equal(decryptProviderSecret(byProvider.openai ?? ""), "sk-openai-byom");
    assert.equal(decryptProviderSecret(byProvider.gemini ?? ""), "gm-key");
    assert.equal(byProvider.ollama, "not-encrypted-at-all");
    assert.equal(byProvider.qwen, null);

    // Re-running against the rotated DB writes nothing.
    process.env.KP_SECRET_PREVIOUS = "test-master-secret";
    const again = rotateDatabaseSecrets(db, { env: {} });
    assert.equal(statsFor(again.results, "provider_keys").rewritten, 0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a dedicated KP_ATS_SECRET_KEY takes the ATS-keyed columns out of the rotation", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kp-rotate-ats-"));
  const db = new Database(path.join(dir, "rotate.sqlite"));
  try {
    db.exec(`CREATE TABLE provider_keys (provider TEXT, scope TEXT, key_ciphertext TEXT)`);
    db.exec(`CREATE TABLE ats_config (id INTEGER PRIMARY KEY, webhook_secret TEXT)`);
    db.prepare(`INSERT INTO ats_config VALUES (1, ?)`).run(encryptProviderSecret("whsec"));
    process.env.KP_SECRET_PREVIOUS = "test-master-secret";
    process.env.KP_SECRET = "the-new-master-secret";
    // Those columns are keyed on KP_ATS_SECRET_KEY, so a KP_SECRET rotation neither
    // breaks nor needs to touch them — rewriting them would in fact break them.
    const decoupled = rotateDatabaseSecrets(db, { env: { KP_ATS_SECRET_KEY: "dedicated" } });
    assert.equal(decoupled.atsDecoupled, true);
    assert.equal(decoupled.results.some((r) => r.table === "ats_config"), false);
    // With it unset they ride along on the same envelope.
    const shared = rotateDatabaseSecrets(db, { env: {} });
    assert.equal(statsFor(shared.results, "ats_config").rewritten, 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
