// The two pure decisions behind the dock's honest states (Direction 2).
//
// Both are classifications the dock makes on every render and neither can be
// reached through React in this runner, so they live in companion-turn.ts (the
// dependency-free half) and are driven directly here — the same split the
// existing companion-turn tests use.
//
// Runner: node:test with type stripping — `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { companionFallbackClass, shouldRefetchCompanionThread } from "./companion-turn.ts";

test("companionFallbackClass separates a missing provider from a provider that failed", () => {
  // The literal companion_cli.py emits when resolve_provider returns nothing or
  // reports itself unavailable. A keyless install is the ordinary case here.
  assert.equal(companionFallbackClass("no provider available"), "noProvider");
  assert.equal(companionFallbackClass("  No Provider Available  "), "noProvider");

  // `f"{type(exc).__name__}: {exc}"[:200]` — the other arm of the same function.
  assert.equal(companionFallbackClass("TimeoutError: read timed out"), "providerFailed");
  assert.equal(companionFallbackClass("httpx.ReadTimeout: timed out after 90s"), "providerFailed");
  assert.equal(companionFallbackClass("ValueError: companion turn returned no text"), "providerFailed");
});

test("companionFallbackClass refuses to guess at a reason it does not know", () => {
  // A CLI older or newer than this dock: the generic chip is the truth we have.
  for (const unknown of [null, undefined, "", "   ", "something else entirely", "no provider available yet"]) {
    assert.equal(companionFallbackClass(unknown), null, `must not classify ${JSON.stringify(unknown)}`);
  }
  // Not an exception shape: a colon alone is not provenance.
  assert.equal(companionFallbackClass(": nope"), null);
  assert.equal(companionFallbackClass("lower case sentence: with a colon"), null);
});

test("the dock re-reads its thread only when an OPEN dock sees the count actually move", () => {
  // The digest landed / a sibling tab answered a proposal: the count moved.
  assert.equal(shouldRefetchCompanionThread(0, 1, true), true);
  assert.equal(shouldRefetchCompanionThread(3, 2, true), true);

  // Nothing moved.
  assert.equal(shouldRefetchCompanionThread(2, 2, true), false);

  // Closed: the rest pill's dot is already the honest signal, and repainting a
  // surface nobody is looking at buys nothing.
  assert.equal(shouldRefetchCompanionThread(0, 1, false), false);

  // The FIRST observation is not a change — the boot fetch just read this very
  // thread, so refetching on it would be a wasted round trip on every open.
  assert.equal(shouldRefetchCompanionThread(null, 1, true), false);
  // …and a poll that failed (counts unknown) is not evidence of anything.
  assert.equal(shouldRefetchCompanionThread(1, null, true), false);
  assert.equal(shouldRefetchCompanionThread(null, null, true), false);
});
