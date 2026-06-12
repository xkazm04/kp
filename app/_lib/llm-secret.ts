// At-rest encryption for UI-entered provider keys (AES-256-GCM under
// KP_SECRET). Dependency-free on purpose — unit-testable without pulling the
// db.ts import chain. Ciphertext format: "v1:<iv b64>:<auth tag b64>:<data b64>".
// KP_SECRET is the operator's master secret (any string; hashed to a 32-byte
// key). Saving a key without KP_SECRET set is refused — storing provider keys
// in plaintext is worse than asking the operator to set one env var.

import crypto from "node:crypto";

function masterKey(): Buffer {
  const secret = process.env.KP_SECRET;
  if (!secret || !secret.trim()) {
    throw new Error("KP_SECRET is not set — set it in .env.local to store provider keys encrypted at rest.");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptProviderSecret(plaintext: string): string {
  const key = masterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${data.toString("base64")}`;
}

export function decryptProviderSecret(ciphertext: string): string {
  const [version, ivB64, tagB64, dataB64] = ciphertext.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Unrecognized provider-key ciphertext format.");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf-8");
}
