// Locks the "empty data vs. failed load" contract that lets the Dev Case Studio
// tell a genuinely empty pipeline apart from an outage. The whole feature hinges
// on `isLoadFailure` NOT classifying a successful-but-empty response as a
// failure (and vice-versa: a non-OK / error-envelope / non-JSON response must
// never render as an innocuous blank). `aggregateLoadState` backs the control
// room's single banner over its two pollers.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { isLoadFailure, aggregateLoadState } from "./load-state.ts";

test("a successful but empty response is NOT a failure", () => {
  // The crux of the requirement: empty data must render as "nothing here yet",
  // never as an outage. An empty array/object payload is a healthy empty result.
  assert.equal(isLoadFailure(true, {}), false);
  assert.equal(isLoadFailure(true, { cases: [] }), false);
  assert.equal(isLoadFailure(true, { lifecycles: [], postings: [] }), false);
});

test("a non-OK HTTP status is a failure regardless of body", () => {
  assert.equal(isLoadFailure(false, { cases: [1, 2] }), true);
  assert.equal(isLoadFailure(false, {}), true);
  assert.equal(isLoadFailure(false, null), true);
});

test("a missing / non-JSON body is a failure", () => {
  // `res.json()` threw → body is null. Must not be mistaken for empty data.
  assert.equal(isLoadFailure(true, null), true);
});

test("an API error envelope is a failure even on a 200", () => {
  assert.equal(isLoadFailure(true, { error: "boom" }), true);
  assert.equal(isLoadFailure(true, { error: "db down", cases: [] }), true);
});

test("a falsy `error` field does not trip the failure check", () => {
  // Mirrors the truthy semantics of the original `body.error` guard: an empty
  // or absent error string is a healthy payload, not a failure.
  assert.equal(isLoadFailure(true, { error: "" }), false);
  assert.equal(isLoadFailure(true, { error: null }), false);
});

test("aggregate is healthy only when every loader is healthy", () => {
  assert.equal(aggregateLoadState([
    { failed: false, lastUpdated: 100 },
    { failed: false, lastUpdated: 200 },
  ]).failed, false);
});

test("aggregate fails if ANY loader failed", () => {
  assert.equal(aggregateLoadState([
    { failed: false, lastUpdated: 100 },
    { failed: true, lastUpdated: 200 },
  ]).failed, true);
});

test("aggregate reports the OLDEST fresh point (most conservative age)", () => {
  // A stale loader behind an outage should set the banner's clock, even if a
  // sibling loader refreshed more recently.
  const merged = aggregateLoadState([
    { failed: true, lastUpdated: 100 },
    { failed: false, lastUpdated: 500 },
  ]);
  assert.equal(merged.lastUpdated, 100);
});

test("aggregate ignores loaders that never succeeded when dating freshness", () => {
  const merged = aggregateLoadState([
    { failed: true, lastUpdated: null },
    { failed: false, lastUpdated: 300 },
  ]);
  assert.equal(merged.lastUpdated, 300);
});

test("aggregate of all-never-loaded has no timestamp", () => {
  assert.deepEqual(
    aggregateLoadState([
      { failed: true, lastUpdated: null },
      { failed: false, lastUpdated: null },
    ]),
    { failed: true, lastUpdated: null },
  );
});

test("aggregate of an empty loader list is healthy with no timestamp", () => {
  assert.deepEqual(aggregateLoadState([]), { failed: false, lastUpdated: null });
});

// --- ONE body-failure rule, not three ---------------------------------------
//
// `isLoadFailure` here, the success test inside `jsonFetchFailure`
// (useJsonFetch) and an inline `!res.ok || !body || body.error` in
// useInfiniteScroll were three hand-rolled statements of the same rule — three
// chances for one of them to drift into rendering an outage as an innocuous
// empty result, which is the whole defect this module exists for. These pin the
// single source and the coercion the three copies each did differently.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { asRecord } from "./load-state.ts";

const readSrc = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

test("asRecord accepts only an object body", () => {
  assert.deepEqual(asRecord({ a: 1 }), { a: 1 });
  assert.equal(asRecord(null), null);
  assert.equal(asRecord(undefined), null);
  assert.equal(asRecord("<html>500</html>"), null, "an HTML error page is not a result");
  assert.equal(asRecord(42), null);
  assert.equal(asRecord([1, 2]), null, "a bare array carries no { error } to read");
});

test("the rule is read, never re-derived, by every hook that loads JSON", () => {
  for (const hook of ["./useJsonFetch.ts", "./useLoader.ts", "./useInfiniteScroll.ts"]) {
    const src = readSrc(hook);
    assert.match(src, /from "\.\/load-state"/, `${hook} must read the shared rule`);
    assert.match(src, /isLoadFailure\(/, `${hook} must CALL it`);
    assert.doesNotMatch(
      src,
      /!res\.ok \|\| !body \|\| body\.error/,
      `${hook} must not re-derive the rule inline`
    );
  }
});

test("useLoader aborts its in-flight request and never writes into an unmounted tree", () => {
  const src = readSrc("./useLoader.ts");
  // The polling sibling of useJsonFetch had neither guard: a poll left in flight
  // when the panel closed ran to completion, kept its server-side child alive and
  // then set `failed` on a screen nobody was looking at.
  assert.match(src, /new AbortController\(\)/);
  assert.match(src, /fetch\(url, \{ signal: controller\.signal \}\)/);
  assert.match(src, /inFlightRef\.current\?\.abort\(\)/, "a newer poll cancels the older one");
  assert.match(src, /aliveRef\.current = false/, "unmount flips the guard");
  assert.match(src, /if \(!aliveRef\.current \|\| controller\.signal\.aborted\) return;/, "every setState is gated");
});
