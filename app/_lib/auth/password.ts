import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Local password credentials (P0 auth). scrypt (memory-hard, built into
// node:crypto — no dependency) over a per-user random salt. The stored value is
// `<saltB64url>:<hashB64url>`; identity (`users`) and this secret
// (`user_credentials`) live in separate tables so a future SSO/OIDC seam can slot
// in without touching either. Node-only (node:crypto) — never import into an Edge
// module or a client component.

const KEYLEN = 64; // scrypt output length in bytes

/** The one minimum-password-length floor for the whole app.
 *
 *  It lives HERE, beside the hash, because the lowest layer that writes a password
 *  (`setUserPassword` in app/_lib/db/users.ts) must enforce it too, and users.ts
 *  cannot import org-service.ts — org-service imports users, so that would be a
 *  cycle. `org-service.ts` re-states the value for its own callers and
 *  `password-floor.test.ts` pins the two together, so a drift is a red test rather
 *  than a quietly weaker signup path. */
export const MIN_PASSWORD_LENGTH = 8;

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

/** A real credential, over a throwaway secret nobody holds, hashed ONCE at module
 *  load with the production scrypt cost.
 *
 *  `verifyCredentials` verifies against this whenever the account is unknown,
 *  disabled, or simply has no credential row — so a miss spends exactly the scrypt
 *  work a real account spends. Without it the login route returned in microseconds
 *  for "no such user" and in ~40ms for "wrong password": a user-existence oracle
 *  measurable over the network, which the deliberately uniform 401 body only
 *  masked at the response level. Module load (not lazy) so the very first miss of
 *  a process is already indistinguishable from a hit. */
export const DUMMY_PASSWORD_HASH: string = hashPassword(randomBytes(32).toString("base64url"));
