import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Local password credentials (P0 auth). scrypt (memory-hard, built into
// node:crypto — no dependency) over a per-user random salt. The stored value is
// `<saltB64url>:<hashB64url>`; identity (`users`) and this secret
// (`user_credentials`) live in separate tables so a future SSO/OIDC seam can slot
// in without touching either. Node-only (node:crypto) — never import into an Edge
// module or a client component.

const KEYLEN = 64; // scrypt output length in bytes

/** Hash a plaintext password → `<saltB64url>:<hashB64url>` for storage. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN);
  return `${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

/** Constant-time verify a plaintext against a stored `<salt>:<hash>` value.
 *  Returns false on any blank/malformed input rather than throwing, so a corrupt
 *  or absent credential row is a failed login, never a 500. */
export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!password || !stored) return false;
  const sep = stored.indexOf(":");
  if (sep <= 0) return false;
  const salt = Buffer.from(stored.slice(0, sep), "base64url");
  const expected = Buffer.from(stored.slice(sep + 1), "base64url");
  if (salt.length === 0 || expected.length !== KEYLEN) return false;
  let actual: Buffer;
  try {
    actual = scryptSync(password, salt, KEYLEN);
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
