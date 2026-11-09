// The seen-record: an entrance is a first-arrival gesture — the cascade plays once per view,
// a later row is a "new member", and nothing replays on a remount or a refresh.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSeenRecord, viewKey } from "./seen.ts";

test("a view's identity is look + kind + params, not the session's panel id", () => {
  const a = viewKey({ kind: "pipelineSlice", params: { role: "Backend", filter: "aging" } }, "table");
  const b = viewKey({ kind: "pipelineSlice", params: { filter: "aging", role: "Backend" } }, "table");
  assert.equal(a, b);
  assert.notEqual(a, viewKey({ kind: "pipelineSlice", params: { role: "Backend", filter: "aging" } }, "insight"));
  assert.notEqual(a, viewKey({ kind: "pipelineSlice", params: { role: "Frontend", filter: "aging" } }, "table"));
});

test("the cascade plays on a view's first arrival only; later rows are members; shown rows stay still", () => {
  const s = createSeenRecord();
  assert.equal(s.seen("v"), false);
  assert.equal(s.row("v", "r1"), "cascade");
  s.mark("v", ["r1", "r2"]);
  assert.equal(s.seen("v"), true);
  assert.equal(s.row("v", "r1"), "still");
  assert.equal(s.row("v", "r3"), "member");
  s.mark("v", ["r3"]);
  assert.equal(s.row("v", "r3"), "still", "a member plays once");
  // Rows are surface-wide: the same candidate in a view never shown does not replay…
  assert.equal(s.row("w", "r1"), "still");
  // …while a row the surface never showed cascades with that view's first arrival.
  assert.equal(s.row("w", "r9"), "cascade");
});
