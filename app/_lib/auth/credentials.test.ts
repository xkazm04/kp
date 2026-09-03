// The two small oracles on the credential path — what a login attempt COSTS, and
// how short a password the store will actually keep.
//
// Neither was pinned by a test, and both are invisible in a response body:
//   * verifyCredentials returned BEFORE the scrypt hash for an unknown or disabled
//     account, so the deliberately uniform 401 ("Incorrect email or password.")
//     was undone by the clock — microseconds for "no such account" against ~40ms
//     for "wrong password" is a user-existence oracle any client can measure.
//   * MIN_PASSWORD_LENGTH was checked by signup-service and org-service but not by
//     the store write both of them go through, so any other path to
//     setUserPassword — createUser({ password }), an admin reset, a script —
//     stored a one-character password without complaint.
//
// The timing assertion counts scrypt WORK, never wall-clock: a millisecond threshold
// on a shared CI box is a flake generator, and the property under test is "the same
// work happens", which the counter states exactly. It counts calls that actually reach
// scrypt — verifyPassword short-circuits on a blank/malformed stored value, so merely
// counting invocations would score a free early return as a spent hash.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { cleanupUnitDb } from "../testing/unit-db.ts";

// Count every verifyPassword the store makes, by resolving users.ts's
// `../auth/password` import to a counting wrapper around the real module. The
// wrapper delegates — this measures the REAL scrypt work, it does not simulate it.
const VIRTUAL_PASSWORD = "kp-test:password-counter";
const REAL_PASSWORD = new URL("./password.ts", import.meta.url).href;
const counter = { hashed: 0 };
(globalThis as { __kpVerifyCounter?: { hashed: number } }).__kpVerifyCounter = counter;

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Only the store's own import — the wrapper below loads the real file by URL.
    if (specifier === "../auth/password" && context.parentURL?.endsWith("/db/users.ts")) {
      return { url: VIRTUAL_PASSWORD, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === VIRTUAL_PASSWORD) {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          import * as real from ${JSON.stringify(REAL_PASSWORD)};
          export const MIN_PASSWORD_LENGTH = real.MIN_PASSWORD_LENGTH;
          export const DUMMY_PASSWORD_HASH = real.DUMMY_PASSWORD_HASH;
          export const hashPassword = real.hashPassword;
          export const needsRehash = real.needsRehash;
          export function verifyPassword(password, stored) {
            // Only a well-formed stored hash makes verifyPassword run scrypt; anything
            // else returns false for free, which is exactly the oracle under test.
            const wellFormed = typeof stored === "string" && /[$:]/.test(stored) && stored.length > 40;
            if (password && wellFormed) {
              globalThis.__kpVerifyCounter.hashed += 1;
            }
            return real.verifyPassword(password, stored);
          }
        `,
      };
    }
    return nextLoad(url, context);
  },
});

const { createUser, setUserPassword, setUserStatus, verifyCredentials } = await import("../db/users.ts");
const { MIN_PASSWORD_LENGTH, DUMMY_PASSWORD_HASH, verifyPassword } = await import("./password.ts");
const { MIN_PASSWORD_LENGTH: SERVICE_FLOOR } = await import("../org-service.ts");

after(() => cleanupUnitDb());
beforeEach(() => {
  counter.hashed = 0;
});

const ORG = "org-default";
const real = createUser({ orgId: ORG, email: "cred.real@csas.cz", name: "Real", status: "active", password: "correct-horse" });
const disabled = createUser({ orgId: ORG, email: "cred.off@csas.cz", name: "Off", status: "active", password: "correct-horse" });
setUserStatus(disabled.id, "disabled");
// An invited user: a row in `users`, nothing in `user_credentials` yet.
createUser({ orgId: ORG, email: "cred.invited@csas.cz", name: "Invited", status: "invited" });

test("a wrong password on a real account spends exactly one hash", () => {
  assert.equal(verifyCredentials("cred.real@csas.cz", "wrong-password"), null);
  assert.equal(counter.hashed, 1, "the baseline every other miss must match");
});

test("an UNKNOWN account spends the hash too — no user-existence timing oracle", () => {
  assert.equal(verifyCredentials("nobody@csas.cz", "wrong-password"), null);
  assert.equal(counter.hashed, 1, "returning early here is what made the 401 a lie");
});

test("a DISABLED account spends the hash", () => {
  assert.equal(verifyCredentials("cred.off@csas.cz", "correct-horse"), null, "disabled cannot sign in");
  assert.equal(counter.hashed, 1);
});

test("an invited account with no credential row spends the hash", () => {
  // verifyPassword short-circuits on a null stored value, so "user exists but has
  // never set a password" was a third, distinct timing signature.
  assert.equal(verifyCredentials("cred.invited@csas.cz", "any-guess-here"), null);
  assert.equal(counter.hashed, 1);
});

test("the dummy hash is a REAL credential, so the miss costs what a hit costs", () => {
  // A malformed or empty stand-in would short-circuit inside verifyPassword and
  // reinstate the oracle with the counter still reading 1.
  assert.match(DUMMY_PASSWORD_HASH, /^v1\$scrypt\$\d+\$\d+\$\d+\$[\w-]+\$[\w-]+$/);
  assert.equal(verifyPassword("not the secret", DUMMY_PASSWORD_HASH), false, "and nobody can guess it");
});

test("the correct password still signs the right user in", () => {
  const user = verifyCredentials("cred.real@csas.cz", "correct-horse");
  assert.equal(user?.id, real.id);
  assert.equal(counter.hashed, 1, "a hit is the same single hash a miss is");
});

test("setUserPassword enforces the shared floor — the store is the last line", () => {
  const target = createUser({ orgId: ORG, email: "cred.floor@csas.cz", name: "Floor", status: "invited" });
  assert.throws(() => setUserPassword(target.id, "short"), /at least 8 characters/);
  assert.throws(() => setUserPassword(target.id, ""), /at least 8 characters/);
  // Refused, not half-applied: the account still has no usable credential.
  assert.equal(verifyCredentials("cred.floor@csas.cz", "short"), null);
  // …and exactly at the floor it is accepted.
  setUserPassword(target.id, "a".repeat(MIN_PASSWORD_LENGTH));
  assert.equal(verifyCredentials("cred.floor@csas.cz", "a".repeat(MIN_PASSWORD_LENGTH))?.id, target.id);
});

test("the floor has ONE value — org-service and the hash module cannot drift apart", () => {
  // users.ts cannot import org-service (org-service imports users), so the constant
  // lives in password.ts and org-service re-states it. This is the join.
  assert.equal(SERVICE_FLOOR, MIN_PASSWORD_LENGTH);
});

// ---- Upgrade-on-login ---------------------------------------------------------
// The stored value carries its format and cost (`v1$scrypt$N$r$p$salt$hash`), so
// "is this hash behind?" is a pure function of the row — and a successful sign-in
// is the one moment the plaintext is legitimately in hand to act on the answer.
// Without this seam, raising the cost later has only two endings: log everybody
// out, or keep the weak hashes forever.

const { needsRehash } = await import("./password.ts");
const { ensureDb } = await import("../db/core.ts");
const { randomBytes, scryptSync } = await import("node:crypto");

/** The raw stored credential, read straight from the table — the only way to see
 *  WHICH hash an account is carrying (verifyCredentials only reports who it is). */
function storedHashRead(userId: string): string | null {
  const row = ensureDb().prepare(`SELECT password_hash FROM user_credentials WHERE user_id = ?`).get(userId) as
    | { password_hash?: string }
    | undefined;
  return row?.password_hash ?? null;
}

function storedHashWrite(userId: string, hash: string): void {
  ensureDb()
    .prepare(
      `INSERT INTO user_credentials (user_id, password_hash, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at`,
    )
    .run(userId, hash, new Date().toISOString());
}

/** Write a credential in the PRE-VERSIONING format straight into the store, the
 *  way every hash in an existing install looks. */
function seedLegacyCredential(userId: string, password: string): string {
  const salt = randomBytes(16);
  const stored = `${salt.toString("base64url")}:${scryptSync(password, salt, 64).toString("base64url")}`;
  storedHashWrite(userId, stored);
  return stored;
}

test("a legacy hash still signs its owner in, and is rewritten in place", () => {
  const user = createUser({ orgId: ORG, email: "cred.legacy@csas.cz", name: "Legacy", status: "active" });
  const before = seedLegacyCredential(user.id, "legacy-password-1");
  assert.ok(needsRehash(before), "the fixture must be a hash the app wants to upgrade");

  assert.equal(verifyCredentials("cred.legacy@csas.cz", "legacy-password-1")?.id, user.id, "nobody is locked out");

  const after = storedHashRead(user.id);
  assert.notEqual(after, before, "a successful login must have rewritten it");
  assert.match(after!, /^v1\$scrypt\$/, "…into the current tagged format");
  assert.equal(needsRehash(after), false);
  // …and the upgrade is transparent: the same password still works, the next
  // login finds nothing to do, and a wrong one is still refused.
  assert.equal(verifyCredentials("cred.legacy@csas.cz", "legacy-password-1")?.id, user.id);
  assert.equal(storedHashRead(user.id), after, "a current hash is left alone — no rewrite per login");
  assert.equal(verifyCredentials("cred.legacy@csas.cz", "wrong-password"), null);
});

test("a FAILED login against a legacy hash rewrites nothing", () => {
  const user = createUser({ orgId: ORG, email: "cred.legacy2@csas.cz", name: "Legacy2", status: "active" });
  const before = seedLegacyCredential(user.id, "legacy-password-2");
  assert.equal(verifyCredentials("cred.legacy2@csas.cz", "not-the-password"), null);
  assert.equal(storedHashRead(user.id), before, "an unproven plaintext must never be written as the new hash");
});

test("a legacy hash of a password BELOW today's floor is left alone", () => {
  // The floor moved after these were written. Rewriting would mean calling
  // setUserPassword with a value it refuses — the account keeps working on its old
  // hash instead of a failed login or a thrown 500.
  const user = createUser({ orgId: ORG, email: "cred.legacy3@csas.cz", name: "Legacy3", status: "active" });
  const before = seedLegacyCredential(user.id, "short");
  assert.equal(verifyCredentials("cred.legacy3@csas.cz", "short")?.id, user.id, "the old credential still opens the account");
  assert.equal(storedHashRead(user.id), before, "…and is not rewritten below the floor");
});
