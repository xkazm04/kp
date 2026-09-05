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
//
// ROTATION. Changing the key used to brick every value sealed under it at once: the auth
// tag fails and the only recovery was to re-enter every ATS token, webhook secret, edge
// key and calendar refresh token by hand. llm-secret.ts closed exactly that hole for
// provider keys with KP_SECRET_PREVIOUS; this file did not have it, so a rotated
// deployment stayed unreadable until `npm run secrets:rotate` had run. It reads the
// PREVIOUS key from KP_ATS_SECRET_KEY_PREVIOUS, falling back to KP_SECRET_PREVIOUS on
// the same single-secret deployments the current key already falls back for. Encryption
// ALWAYS uses the current key, so no new ciphertext is ever written under the old one,
// and `reencryptAtsSecret` lets a store heal a row on its next write.

import crypto from "node:crypto";

/** True when a key is available to encrypt/decrypt the webhook secret at rest. */
export function atsSecretKeyConfigured(): boolean {
  return !!(process.env.KP_ATS_SECRET_KEY?.trim() || process.env.KP_SECRET?.trim());
}

/** The retired key a rotation is still reading from, or null. Never used to ENCRYPT.
 *  Mirrors the current key's own fallback chain: a deployment that set only KP_SECRET
 *  rotates through KP_SECRET_PREVIOUS, one that decoupled with KP_ATS_SECRET_KEY
 *  rotates through KP_ATS_SECRET_KEY_PREVIOUS. */
function previousKey(): Buffer | null {
  const secret = process.env.KP_ATS_SECRET_KEY_PREVIOUS?.trim() || process.env.KP_SECRET_PREVIOUS?.trim();
  if (!secret) return null;
  return crypto.createHash("sha256").update(secret).digest();
}

function decryptWith(key: Buffer, ivB64: string, tagB64: string, dataB64: string): string {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf-8");
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
  return decryptAtsSecretDetailed(ciphertext).plaintext;
}

/** Decrypt, and say WHICH key opened it. `under: "previous"` is the signal a store acts
 *  on (that row still needs re-encrypting) and the reason the plain reader above stays a
 *  one-liner for every other caller. */
export function decryptAtsSecretDetailed(ciphertext: string): { plaintext: string; under: "current" | "previous" } {
  const [version, ivB64, tagB64, dataB64] = ciphertext.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Unrecognized ATS secret ciphertext format.");
  }
  try {
    return { plaintext: decryptWith(masterKey(), ivB64, tagB64, dataB64), under: "current" };
  } catch (err) {
    const fallback = previousKey();
    // No retired key configured, so the current-key failure IS the answer: rethrow it
    // unchanged rather than inventing a rotation-flavoured message.
    if (!fallback) throw err;
    try {
      return { plaintext: decryptWith(fallback, ivB64, tagB64, dataB64), under: "previous" };
    } catch {
      // Neither key opens it: report the CURRENT key's failure, which is the one an
      // operator who has finished rotating needs to see.
      throw err;
    }
  }
}

/**
 * Re-encrypt one stored value under the CURRENT key. `changed` is false when the row was
 * already current, so a caller can skip the write and a re-run is a no-op. Throws when
 * neither key opens the value: rewriting a row we cannot read would destroy the only copy
 * of the credential.
 */
export function reencryptAtsSecret(ciphertext: string): { ciphertext: string; changed: boolean } {
  const { plaintext, under } = decryptAtsSecretDetailed(ciphertext);
  if (under === "current") return { ciphertext, changed: false };
  return { ciphertext: encryptAtsSecret(plaintext), changed: true };
}
