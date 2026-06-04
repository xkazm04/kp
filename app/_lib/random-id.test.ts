// Pins the id/token format of the shared helper (consolidated from the entropy
// expression that used to be inlined across the stores + the apply route) so it
// can't silently drift on prefix or slice shape. Runner: Node's built-in test
// runner with type stripping.
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomId, randomToken } from "./random-id.ts";

test("randomId: '<prefix>-<base36 time>-<random>' shape", () => {
  const id = randomId("off");
  assert.ok(id.startsWith("off-"));
  const parts = id.split("-");
  assert.equal(parts.length, 3);
  assert.match(parts[1], /^[0-9a-z]+$/); // base36 timestamp
  assert.match(parts[2], /^[0-9a-z]*$/); // up to 6 base36 random chars
});

test("randomToken: '<prefix>-<base36 random>' shape", () => {
  const token = randomToken("tk");
  assert.ok(token.startsWith("tk-"));
  assert.match(token.slice("tk-".length), /^[0-9a-z]*$/);
});

test("ids and tokens are distinct across calls", () => {
  assert.equal(new Set(Array.from({ length: 100 }, () => randomId("x"))).size, 100);
  assert.equal(new Set(Array.from({ length: 100 }, () => randomToken("x"))).size, 100);
});
