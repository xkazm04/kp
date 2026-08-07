// At-rest encryption for the ATS webhook HMAC signing secret (AES-256-GCM).
// Mirrors llm-secret.ts (provider keys under KP_SECRET) but keys on a DEDICATED
// KP_ATS_SECRET_KEY so rotating the auth/session secret (KP_SECRET) never
// invalidates the stored webhook secret — and vice-versa. Falls back to KP_SECRET
// when the dedicated key is unset, so an existing single-secret deployment keeps
// working without a new required env var; set KP_ATS_SECRET_KEY to decouple.
//
// WHY: the signing secret was persisted PLAINTEXT in ats_config.webhook_secret and
// the whole-DB export (db-portability) dumps every column verbatim — shipping the
// HMAC secret in clear out a door the guarded GET (hasSecret-only) never opened.
// Encrypting at rest means only CIPHERTEXT is ever stored OR exported; the plaintext
// exists only transiently in memory while a body is signed. A leaked signing secret
// lets an attacker forge valid `sha256=` signatures, so it must never touch disk.
//
// Ciphertext format: "v1:<iv b64>:<auth tag b64>:<data b64>" (same as llm-secret).
// Dependency-free on purpose — unit-testable without the db.ts import chain.

import crypto from "node:crypto";

/** True when a key is available to encrypt/decrypt the webhook secret at rest. */
export function atsSecretKeyConfigured(): boolean {
  return !!(process.env.KP_ATS_SECRET_KEY?.trim() || process.env.KP_SECRET?.trim());
}

function masterKey(): Buffer {
  const secret = process.env.KP_ATS_SECRET_KEY?.trim() || process.env.KP_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "KP_ATS_SECRET_KEY (or KP_SECRET) is not set — set one to store the ATS webhook signing secret encrypted at rest."
    );
  }
  return crypto.createHash("sha256").update(secret).digest();
}

const CIPHERTEXT_PREFIX = "v1:";

/** True when a stored value is our ciphertext envelope (vs a legacy plaintext secret
 *  written before at-rest encryption existed). Lets the reader tolerate legacy rows. */
export function isEncryptedAtsSecret(value: string): boolean {
  return value.startsWith(CIPHERTEXT_PREFIX);
}

export function encryptAtsSecret(plaintext: string): string {
  const key = masterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${data.toString("base64")}`;
}

export function decryptAtsSecret(ciphertext: string): string {
  const [version, ivB64, tagB64, dataB64] = ciphertext.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Unrecognized ATS secret ciphertext format.");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf-8");
}
