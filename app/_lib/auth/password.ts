import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Local password credentials (P0 auth). scrypt (memory-hard, built into
// node:crypto — no dependency) over a per-user random salt. Identity (`users`)
// and this secret (`user_credentials`) live in separate tables so a future
// SSO/OIDC seam can slot in without touching either. Node-only (node:crypto) —
// never import into an Edge module or a client component.
//
// THE STORED VALUE CARRIES ITS OWN PARAMETERS:
//
//   v1$scrypt$16384$8$1$<saltB64url>$<hashB64url>
//   └┬┘ └─┬──┘ └─┬─┘ │ │
//    │    │      │   │ └ p (parallelization)
//    │    │      │   └── r (block size)
//    │    │      └────── N (cost)
//    │    └───────────── KDF
//    └────────────────── format version
//
// It used to be a bare `<salt>:<hash>` with the cost implied by node's defaults,
// which is fine right up to the day the cost has to move: with nothing recorded
// on the row there is no way to ask "is this hash behind?", so raising N would
// have meant either invalidating every password in the install or carrying an
// undocumented "hashes written before <date> are cheap" rule forever. Now the
// answer is a pure function of the row ({@link needsRehash}) and the upgrade
// happens on the one occasion the plaintext is legitimately in hand — a
// successful sign-in (`verifyCredentials` in ../db/users.ts).
//
// LEGACY `<salt>:<hash>` VALUES STILL VERIFY, at node's scrypt defaults (which is
// what wrote them), and are reported as needing a rehash. Nobody is logged out by
// this change; they are upgraded in place as they return.

const KEYLEN = 64; // scrypt output length in bytes

/** The parameters NEW hashes are written with. Raising any of these makes every
 *  older stored value `needsRehash()` — that is the whole point of recording them
 *  on the row. `N` must stay a power of two (scrypt's own constraint). */
const CURRENT = { N: 16384, r: 8, p: 1 } as const;
const CURRENT_VERSION = "v1";
const CURRENT_KDF = "scrypt";

/** scrypt's working set is 128·N·r bytes and node's default `maxmem` is 32 MiB,
 *  which the CURRENT parameters (16 MiB) fit under — but a future N bump would
 *  throw instead of hashing. Asked for explicitly so the cost, not an undeclared
 *  library default, is what bounds it. */
function maxmemFor(N: number, r: number): number {
  return Math.max(32 * 1024 * 1024, 256 * N * r);
}

/** The floor above which a parsed parameter is refused outright, so a corrupt or
 *  hostile stored value can never turn a login into a memory bomb. */
const MAX_N = 1 << 20;
const MAX_R = 64;
const MAX_P = 16;

/** The one minimum-password-length floor for the whole app.
 *
 *  It lives HERE, beside the hash, because the lowest layer that writes a password
 *  (`setUserPassword` in app/_lib/db/users.ts) must enforce it too, and users.ts
 *  cannot import org-service.ts — org-service imports users, so that would be a
 *  cycle. `org-service.ts` re-states the value for its own callers and
 *  `credentials.test.ts` pins the two together, so a drift is a red test rather
 *  than a quietly weaker signup path. */
export const MIN_PASSWORD_LENGTH = 8;

type Parsed = { salt: Buffer; expected: Buffer; N: number; r: number; p: number; legacy: boolean };

/** Decode a stored credential into the parameters it was written with, or null
 *  when it is blank, truncated, or otherwise not a credential this module wrote.
 *  Never throws: a corrupt row is a failed login, not a 500. */
function parseStored(stored: string): Parsed | null {
  if (stored.includes("$")) {
    const parts = stored.split("$");
    if (parts.length !== 7) return null;
    const [version, kdf, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
    if (version !== CURRENT_VERSION || kdf !== CURRENT_KDF) return null;
    const N = Number(nRaw);
    const r = Number(rRaw);
    const p = Number(pRaw);
    const sane =
      Number.isInteger(N) && N > 1 && N <= MAX_N && (N & (N - 1)) === 0 &&
      Number.isInteger(r) && r >= 1 && r <= MAX_R &&
      Number.isInteger(p) && p >= 1 && p <= MAX_P;
    if (!sane) return null;
    const salt = Buffer.from(saltRaw, "base64url");
    const expected = Buffer.from(hashRaw, "base64url");
    if (salt.length === 0 || expected.length !== KEYLEN) return null;
    return { salt, expected, N, r, p, legacy: false };
  }
  // Legacy `<saltB64url>:<hashB64url>`, written at node's scrypt defaults.
  const sep = stored.indexOf(":");
  if (sep <= 0) return null;
  const salt = Buffer.from(stored.slice(0, sep), "base64url");
  const expected = Buffer.from(stored.slice(sep + 1), "base64url");
  if (salt.length === 0 || expected.length !== KEYLEN) return null;
  return { salt, expected, N: 16384, r: 8, p: 1, legacy: true };
}

/** Hash a plaintext password for storage, at the CURRENT parameters, tagged with
 *  them: `v1$scrypt$N$r$p$<salt>$<hash>`. */
export function hashPassword(password: string): string {
  const { N, r, p } = CURRENT;
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N, r, p, maxmem: maxmemFor(N, r) });
  return `${CURRENT_VERSION}$${CURRENT_KDF}$${N}$${r}$${p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

/** Constant-time verify a plaintext against a stored credential, in EITHER format
 *  — the current tagged one and the legacy `<salt>:<hash>`, each checked at the
 *  parameters it was written with. Returns false on any blank/malformed input
 *  rather than throwing, so a corrupt or absent credential row is a failed login,
 *  never a 500. */
export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!password || !stored) return false;
  const parsed = parseStored(stored);
  if (!parsed) return false;
  let actual: Buffer;
  try {
    actual = scryptSync(password, parsed.salt, KEYLEN, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: maxmemFor(parsed.N, parsed.r),
    });
  } catch {
    // An unreachable-in-practice scrypt refusal (a parameter combination node
    // rejects). A credential we cannot evaluate is a credential that does not
    // open the account — never a thrown 500 on the login path.
    return false;
  }
  return actual.length === parsed.expected.length && timingSafeEqual(actual, parsed.expected);
}

/** True when `stored` was written in an older FORMAT or at a WEAKER cost than the
 *  one this module writes today — i.e. the caller should re-hash the plaintext it
 *  has just successfully verified and store the result.
 *
 *  An unparseable value is NOT reported as upgradable: it cannot be verified, so
 *  no caller will ever hold a plaintext proven against it, and answering true
 *  would only invite a rewrite driven by a failed login. Stronger-than-current
 *  parameters are left alone too — downgrading a hash is not an upgrade. */
export function needsRehash(stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parsed = parseStored(stored);
  if (!parsed) return false;
  if (parsed.legacy) return true;
  return parsed.N < CURRENT.N || parsed.r < CURRENT.r || parsed.p < CURRENT.p;
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
