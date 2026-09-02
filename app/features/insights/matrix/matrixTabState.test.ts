// matrix-answers-with-codes-and-retries (c). The tab's two untested decisions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveMatrixMode, pickGridState } from "./matrixTabState.ts";

// --- deriveMatrixMode --------------------------------------------------------

test("no ?profile= and no override is the grid", () => {
  assert.equal(deriveMatrixMode(null, null), "grid");
});

test("a ?profile= arrival switches to focus with no override in play", () => {
  assert.equal(deriveMatrixMode("cand-7", null), "focus");
});

test("a manual toggle wins while it is stamped with the CURRENT param", () => {
  assert.equal(deriveMatrixMode("cand-7", { mode: "grid", forParam: "cand-7" }), "grid");
  assert.equal(deriveMatrixMode(null, { mode: "focus", forParam: null }), "focus");
});

test("a LATER ?profile= arrival expires the override — the whole point of the stamp", () => {
  // The reader opened focus for cand-7, toggled back to the grid, then clicked a second
  // cell's "View full match". Without expiry the stamped "grid" would swallow it.
  assert.equal(deriveMatrixMode("cand-9", { mode: "grid", forParam: "cand-7" }), "focus");
});

test("leaving focus (param cleared) expires an override stamped against a param", () => {
  assert.equal(deriveMatrixMode(null, { mode: "focus", forParam: "cand-7" }), "grid");
});

// --- pickGridState -----------------------------------------------------------

const base = { hasError: false, hasData: true, staleJob: false, candidateCount: 3, positionCount: 2, rowCount: 3, colCount: 2 };

test("a healthy grid renders the grid", () => {
  assert.equal(pickGridState(base), "grid");
});

test("no data yet is the loading reserve, not an empty state", () => {
  assert.equal(pickGridState({ ...base, hasData: false }), "loading");
});

test("an error outranks everything, including a still-empty fetch", () => {
  assert.equal(pickGridState({ ...base, hasError: true, hasData: false, staleJob: true }), "error");
});

test("a stale ?job= outranks empty and filtered", () => {
  assert.equal(pickGridState({ ...base, staleJob: true, candidateCount: 0, rowCount: 0 }), "stale");
});

test("an empty pool is 'empty' — either axis", () => {
  assert.equal(pickGridState({ ...base, candidateCount: 0 }), "empty");
  assert.equal(pickGridState({ ...base, positionCount: 0 }), "empty");
});

test("a pool that exists but is filtered to nothing is recoverable, not 'empty'", () => {
  // The distinction the recruiter acts on: "source candidates" vs "clear your filters".
  assert.equal(pickGridState({ ...base, rowCount: 0 }), "filtered");
  assert.equal(pickGridState({ ...base, colCount: 0 }), "filtered");
});
