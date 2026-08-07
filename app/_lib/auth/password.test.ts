import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "./password.ts";

test("hash → verify round-trips for the correct password", () => {
  const stored = hashPassword("correct horse battery staple");
  assert.ok(stored.includes(":"), "stored value is salt:hash");
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
});

test("the same password hashes differently each time (random salt) but both verify", () => {
  const a = hashPassword("same");
  const b = hashPassword("same");
  assert.notEqual(a, b);
  assert.equal(verifyPassword("same", a), true);
  assert.equal(verifyPassword("same", b), true);
});
