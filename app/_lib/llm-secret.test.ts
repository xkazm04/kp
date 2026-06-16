// At-rest encryption contract for UI-entered provider keys: roundtrip under
// KP_SECRET, tamper rejection via the GCM auth tag, and the refuse-to-store
// guard when no master secret is configured.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { decryptProviderSecret, encryptProviderSecret } from "./llm-secret.ts";

beforeEach(() => {
  process.env.KP_SECRET = "test-master-secret";
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
