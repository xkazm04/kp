// Pins the `entries=` batch guard (idea-191ccc0c): the param is split, trimmed,
// de-duped and capped at the trust boundary, and the IN-query chunker stays below
// the SQLite variable limit. Together these stop a crafted/huge id list from
// blowing SQLITE_MAX_VARIABLE_NUMBER or amplifying the query.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseEntriesParam, chunk, MAX_ENTRIES_BATCH, SQL_IN_CHUNK } from "./entries-param.ts";

test("the chunk size stays below the 999-variable floor of old SQLite builds", () => {
  assert.ok(SQL_IN_CHUNK < 999, `SQL_IN_CHUNK ${SQL_IN_CHUNK} must be < 999`);
});

test("parseEntriesParam splits, trims and drops blanks", () => {
  assert.deepEqual(parseEntriesParam(" a , b ,, c , "), ["a", "b", "c"]);
});

test("parseEntriesParam de-dupes repeated ids", () => {
  assert.deepEqual(parseEntriesParam("a,a,b,a,b"), ["a", "b"]);
});

test("parseEntriesParam treats null/empty as no ids", () => {
  assert.deepEqual(parseEntriesParam(null), []);
  assert.deepEqual(parseEntriesParam(""), []);
  assert.deepEqual(parseEntriesParam("   "), []);
});

test("parseEntriesParam caps oversized input at MAX_ENTRIES_BATCH", () => {
  const raw = Array.from({ length: MAX_ENTRIES_BATCH + 5_000 }, (_, i) => `id${i}`).join(",");
  const parsed = parseEntriesParam(raw);
  assert.equal(parsed.length, MAX_ENTRIES_BATCH);
  assert.equal(parsed[0], "id0"); // keeps the leading window
});

test("chunk partitions an array without dropping or duplicating items", () => {
  const ids = Array.from({ length: 950 }, (_, i) => `id${i}`);
  const chunks = chunk(ids, SQL_IN_CHUNK);
  assert.ok(chunks.every((c) => c.length <= SQL_IN_CHUNK), "no chunk exceeds the limit");
  assert.deepEqual(chunks.flat(), ids, "chunks recombine to the original list in order");
});

test("chunk handles the empty and exact-multiple cases", () => {
  assert.deepEqual(chunk([], SQL_IN_CHUNK), []);
  const ids = Array.from({ length: SQL_IN_CHUNK * 2 }, (_, i) => i);
  assert.equal(chunk(ids, SQL_IN_CHUNK).length, 2);
});
