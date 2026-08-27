// Regression guard for the dedupe utility — the canonical deduplication layer
// for string lists emitted by LLM analysis (strengths, gaps, skills, sources).
// Without deduplication, a repeated model output appears twice in the UI, collides
// as a React key, and mis-binds hover state to the wrong row. These tests pin:
//   1. First-occurrence order is preserved (JavaScript Set guarantees insertion
//      order; this guard catches a refactor that drops that guarantee).
//   2. Case-distinct strings are separate entries (no implicit normalization —
//      explicit contract so callers know they must normalize before calling if
//      they want case-insensitive dedupe).
//   3. dedupeBy keeps the FIRST occurrence of each key and discards the rest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupe, dedupeBy } from "./dedupe.ts";

// ── dedupe ────────────────────────────────────────────────────────────────────

test("dedupe: empty array yields empty array", () => {
  assert.deepEqual(dedupe([]), []);
});

test("dedupe: all-unique list preserves input order", () => {
  assert.deepEqual(dedupe(["b", "a", "c"]), ["b", "a", "c"]);
});

test("dedupe: first occurrence wins — later duplicates are dropped", () => {
  assert.deepEqual(dedupe(["a", "b", "a", "c", "b"]), ["a", "b", "c"]);
});

test("dedupe: case-distinct strings are separate entries (no normalization)", () => {
  // "Proactive communicator" and "proactive communicator" are model variants;
  // neither should be silently collapsed.
  assert.deepEqual(dedupe(["a", "A"]), ["a", "A"]);
});

test("dedupe: empty string is a valid distinct value", () => {
  assert.deepEqual(dedupe(["", "a", ""]), ["", "a"]);
});

test("dedupe: a list of all-identical values collapses to one entry", () => {
  assert.deepEqual(dedupe(["x", "x", "x"]), ["x"]);
});

// ── dedupeBy ─────────────────────────────────────────────────────────────────

test("dedupeBy: empty array yields empty array", () => {
  assert.deepEqual(dedupeBy([], (x: string) => x), []);
});

test("dedupeBy: first occurrence wins for each key — later collisions discarded", () => {
  const items = [
    { id: "a", v: 1 },
    { id: "b", v: 2 },
    { id: "a", v: 3 },
  ];
  assert.deepEqual(dedupeBy(items, (x) => x.id), [
    { id: "a", v: 1 },
    { id: "b", v: 2 },
  ]);
});

test("dedupeBy: all-same-key collapses to exactly the first item", () => {
  const items = [{ name: "first" }, { name: "second" }, { name: "third" }];
  assert.deepEqual(dedupeBy(items, () => "shared-key"), [{ name: "first" }]);
});

test("dedupeBy: all-distinct keys — every item kept, order preserved", () => {
  const items = ["alpha", "beta", "gamma"];
  assert.deepEqual(dedupeBy(items, (x) => x), ["alpha", "beta", "gamma"]);
});

test("dedupeBy: key comparison is exact — no implicit case normalization", () => {
  const items = [{ label: "TypeScript" }, { label: "typescript" }];
  const result = dedupeBy(items, (x) => x.label);
  assert.equal(result.length, 2, "case-distinct keys are NOT collapsed");
});

test("dedupeBy: empty-string key is a valid dedup identity", () => {
  // Two items whose key function returns "" share the same bucket — only the first
  // is kept. This is intentional: callers own normalization.
  const items = [{ tag: "", v: 1 }, { tag: "", v: 2 }, { tag: "x", v: 3 }];
  assert.deepEqual(dedupeBy(items, (x) => x.tag), [{ tag: "", v: 1 }, { tag: "x", v: 3 }]);
});
