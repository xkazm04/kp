// Pins the RediscoveryFeed add-to-pipeline transition (sourcing-campaigns-rediscovery
// #4). The bug: on success the feed did `setAdded(add(id))` then IMMEDIATELY
// `dismiss(a.id)`, filtering the row out in the same tick — so the `added.has(id)`
// "Added ✓" badge branch was unreachable dead code and the row vanished with no
// confirmation.
//
// Non-vacuity: pre-fix, success meant "dismiss immediately". This transition returns
// dismiss:"deferred" on success (keep the row + badge, dismiss after a beat).
// Asserting "deferred" fails against the immediate-dismiss pre-fix behavior — the
// only way to satisfy it is to keep the row long enough to render the badge.
//
// Runner: node --test with type stripping (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAddResult } from "./jobsRediscoveryAdd.ts";

test("a successful add marks the candidate added and DEFERS the dismiss (badge stays visible)", () => {
  const next = applyAddResult({ added: new Set(), rowError: new Map() }, "c1", { ok: true });
  assert.equal(next.added.has("c1"), true);
  assert.equal(next.dismiss, "deferred");
  assert.equal(next.rowError.has("c1"), false);
});

test("a successful add clears any prior error for that candidate", () => {
  const next = applyAddResult({ added: new Set(), rowError: new Map([["c1", "old"]]) }, "c1", { ok: true });
  assert.equal(next.rowError.has("c1"), false);
  assert.equal(next.added.has("c1"), true);
});

test("a failed add records the error, never adds, and does not dismiss", () => {
  const next = applyAddResult(
    { added: new Set(), rowError: new Map() },
    "c1",
    { ok: false, message: "boom" }
  );
  assert.equal(next.added.has("c1"), false);
  assert.equal(next.rowError.get("c1"), "boom");
  assert.equal(next.dismiss, "none");
});

test("returns fresh copies — the input set/map are not mutated", () => {
  const added = new Set<string>();
  const rowError = new Map<string, string>();
  applyAddResult({ added, rowError }, "c1", { ok: true });
  assert.equal(added.size, 0);
  assert.equal(rowError.size, 0);
});
