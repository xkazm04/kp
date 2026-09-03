import { test } from "node:test";
import assert from "node:assert/strict";
import { scryptSync, randomBytes } from "node:crypto";
import { hashPassword, needsRehash, verifyPassword } from "./password.ts";

/** A credential in the pre-versioning format, written exactly the way the old
 *  hashPassword wrote it: node's scrypt defaults, `<saltB64url>:<hashB64url>`. */
function legacyHash(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("base64url")}:${scryptSync(password, salt, 64).toString("base64url")}`;
}

test("a new hash records the format, the KDF and the cost it was written at", () => {
  const stored = hashPassword("correct horse battery staple");
  assert.match(stored, /^v1\$scrypt\$16384\$8\$1\$[\w-]+\$[\w-]+$/, "the parameters must travel with the row");
  assert.equal(verifyPassword("correct horse battery staple", stored), true);
});

test("verify rejects the wrong password (case-sensitive, non-empty)", () => {
  const stored = hashPassword("s3cret");
  assert.equal(verifyPassword("S3cret", stored), false);
  assert.equal(verifyPassword("", stored), false);
});

test("verify fails closed on malformed / missing stored values", () => {
  assert.equal(verifyPassword("x", null), false);
  assert.equal(verifyPassword("x", undefined), false);
  assert.equal(verifyPassword("x", ""), false);
  assert.equal(verifyPassword("x", "nocolon"), false);
  assert.equal(verifyPassword("x", ":abc"), false);
  // Tagged but not ours, truncated, or carrying nonsense parameters — a corrupt
  // row is a failed login, never a thrown 500 on the login path.
  assert.equal(verifyPassword("x", "v2$scrypt$16384$8$1$YWJj$YWJj"), false);
  assert.equal(verifyPassword("x", "v1$argon2id$16384$8$1$YWJj$YWJj"), false);
  assert.equal(verifyPassword("x", "v1$scrypt$16384$8$1$YWJj"), false);
  assert.equal(verifyPassword("x", "v1$scrypt$99999$8$1$YWJj$YWJj"), false, "N must be a power of two");
  assert.equal(verifyPassword("x", `v1$scrypt$2097152$8$1$YWJj$${"a".repeat(86)}`), false, "an absurd N is refused, not run");
});

test("the same password hashes differently each time (random salt) but both verify", () => {
  const a = hashPassword("same");
  const b = hashPassword("same");
  assert.notEqual(a, b);
  assert.equal(verifyPassword("same", a), true);
  assert.equal(verifyPassword("same", b), true);
});

// ---- Both directions of the format upgrade ------------------------------------
// Nobody is logged out by the versioning change: a hash written before it still
// opens its account, and says so by reporting that it wants rewriting.

test("a LEGACY salt:hash credential still verifies", () => {
  const stored = legacyHash("old-password-1");
  assert.ok(!stored.includes("$"), "the fixture must be the untagged format");
  assert.equal(verifyPassword("old-password-1", stored), true, "an existing member must not be locked out");
  assert.equal(verifyPassword("not-their-password", stored), false);
});

test("needsRehash is true for a legacy hash and false for a current one", () => {
  assert.equal(needsRehash(legacyHash("old-password-1")), true, "untagged means unknown cost — always behind");
  assert.equal(needsRehash(hashPassword("new-password-1")), false, "a hash at today's parameters is not behind");
});

test("needsRehash is true for a WEAKER cost and false for a stronger one", () => {
  // Same format, cost below CURRENT: the case a future N bump creates.
  const salt = randomBytes(16);
  const weak = `v1$scrypt$1024$8$1$${salt.toString("base64url")}$${scryptSync("pw", salt, 64, { N: 1024, r: 8, p: 1 }).toString("base64url")}`;
  assert.equal(verifyPassword("pw", weak), true, "a weaker hash must still verify at ITS OWN parameters");
  assert.equal(needsRehash(weak), true);

  const strong = `v1$scrypt$32768$8$1$${salt.toString("base64url")}$${scryptSync("pw", salt, 64, { N: 32768, r: 8, p: 1, maxmem: 128 * 32768 * 8 * 2 }).toString("base64url")}`;
  assert.equal(verifyPassword("pw", strong), true);
  assert.equal(needsRehash(strong), false, "downgrading a stronger hash is not an upgrade");
});

test("needsRehash never asks to rewrite something that cannot be verified", () => {
  // A rewrite is only ever driven by a SUCCESSFUL login, so an unreadable value
  // reporting true would be an invitation nobody can act on.
  for (const junk of [null, undefined, "", "nocolon", "v9$blake3$1$1$1$a$b"]) {
    assert.equal(needsRehash(junk), false, `${String(junk)} must not be reported as upgradable`);
  }
});
