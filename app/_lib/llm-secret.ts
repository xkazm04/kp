// At-rest encryption for UI-entered provider keys (AES-256-GCM under
// KP_SECRET). Dependency-free on purpose — unit-testable without pulling the
// db.ts import chain. Ciphertext format: "v1:<iv b64>:<auth tag b64>:<data b64>".
// KP_SECRET is the operator's master secret (any string; hashed to a 32-byte
// key). Saving a key without KP_SECRET set is refused — storing provider keys
// in plaintext is worse than asking the operator to set one env var.
//
// ROTATION. Changing KP_SECRET used to brick every stored provider key at once:
// the auth tag fails, `buildLlmConfigEnv` throws, and the only recovery was for
// the operator to re-enter every key by hand — for a routine credential rotation,
// or after a restore onto a host whose env was rebuilt. `KP_SECRET_PREVIOUS`
// closes that: decryption tries the current secret and then, only if that fails,
// the previous one, so a rotated deployment keeps working while
// `npm run secrets:rotate` (scripts/secrets-rotate.mjs) re-encrypts every stored
// row under the current secret. Encryption ALWAYS uses the current secret, so no
// new ciphertext is ever written under the old key. Unset KP_SECRET_PREVIOUS once
// the rotation script reports zero rows left — two live keys is a transitional
// state, not a resting one.

import crypto from "node:crypto";

// One-time loud warning for a weak KP_SECRET. The same secret keys BOTH the at-rest
// provider-key encryption (here) and the session HMAC (session.ts), so a short/
// low-entropy value weakens the whole security posture. NOT a hard reject: refusing
// would brick an existing deployment whose stored keys were encrypted under the
// current secret (they'd become undecryptable) and would lock the operator out of
// sessions. We only nag in production — a dev .env.local secret may legitimately be
// short — and only once, to avoid log spam on a hot path.
const MIN_SECRET_LEN = 24;
let _weakSecretWarned = false;
function warnIfWeakSecret(secret: string): void {
  if (_weakSecretWarned || process.env.NODE_ENV !== "production") return;
  if (secret.trim().length < MIN_SECRET_LEN) {
    _weakSecretWarned = true;
    console.warn(
      `[security] KP_SECRET is shorter than ${MIN_SECRET_LEN} characters — weak for HMAC + at-rest ` +
        "encryption. Use a long random secret (e.g. `openssl rand -base64 32`)."
    );
  }
}

function masterKey(): Buffer {
  const secret = process.env.KP_SECRET;
  if (!secret || !secret.trim()) {
    throw new Error("KP_SECRET is not set — set it in .env.local to store provider keys encrypted at rest.");
  }
  warnIfWeakSecret(secret);
  return crypto.createHash("sha256").update(secret).digest();
}

/** The retired secret a rotation is still reading from, or null. Never used to
 *  ENCRYPT — see the rotation note in the header. */
function previousKey(): Buffer | null {
  const secret = process.env.KP_SECRET_PREVIOUS;
  if (!secret || !secret.trim()) return null;
  return crypto.createHash("sha256").update(secret).digest();
}

const CIPHERTEXT_PREFIX = "v1:";

/** True for our AES-256-GCM envelope, so a caller walking stored rows can skip a
 *  column holding something else (a legacy plaintext value, an empty string)
 *  instead of failing the whole rotation on it. */
export function isProviderSecretCiphertext(value: string): boolean {
  return value.startsWith(CIPHERTEXT_PREFIX);
}

function decryptWith(key: Buffer, ivB64: string, tagB64: string, dataB64: string): string {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf-8");
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
  return decryptProviderSecretDetailed(ciphertext).plaintext;
}

/** Decrypt, and say WHICH secret opened it. `under: "previous"` is the signal the
 *  rotation script acts on (that row still needs re-encrypting) and the reason the
 *  plain `decryptProviderSecret` above can stay a one-liner for every other caller. */
export function decryptProviderSecretDetailed(ciphertext: string): { plaintext: string; under: "current" | "previous" } {
  const [version, ivB64, tagB64, dataB64] = ciphertext.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Unrecognized provider-key ciphertext format.");
  }
  try {
    return { plaintext: decryptWith(masterKey(), ivB64, tagB64, dataB64), under: "current" };
  } catch (err) {
    const fallback = previousKey();
    // No retired secret configured, so the current-key failure IS the answer:
    // rethrow it unchanged rather than inventing a rotation-flavoured message.
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
 * Re-encrypt one stored value under the current KP_SECRET. `changed` is false when
 * the row was already under the current secret — the rotation script then leaves the
 * row untouched, so a re-run is a no-op and a half-finished rotation can simply be
 * run again. Throws when neither KP_SECRET nor KP_SECRET_PREVIOUS opens the value:
 * rewriting a row we cannot read would destroy the only copy of the credential.
 */
export function reencryptProviderSecret(ciphertext: string): { ciphertext: string; changed: boolean } {
  const { plaintext, under } = decryptProviderSecretDetailed(ciphertext);
  if (under === "current") return { ciphertext, changed: false };
  return { ciphertext: encryptProviderSecret(plaintext), changed: true };
}
