// Runner: `npm run test:unit`.
//
// Red-first premise: `composedAt` was stored by the compose route and read by no
// UI at all (`grep -rn composedAt app/features` found one WRITE and no reader),
// so a spec composed against an early brief looked exactly like one composed a
// second ago.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SPEC_VINTAGE_GRACE_MS, specVintage } from "./spec-vintage.ts";

const at = (msFromEpoch: number) => new Date(msFromEpoch).toISOString();
const T = Date.UTC(2026, 8, 5, 12, 0, 0);

test("a brief that moved after the compose is stale", () => {
  assert.equal(specVintage({ composedAt: at(T), briefUpdatedAt: at(T + 60_000) }), "stale");
});

test("a brief that has not moved is current", () => {
  assert.equal(specVintage({ composedAt: at(T), briefUpdatedAt: at(T) }), "current");
  // The session was read BEFORE the compose — the common case straight after a
  // compose, where applySession patches the spec but not the row version.
  assert.equal(specVintage({ composedAt: at(T), briefUpdatedAt: at(T - 90_000) }), "current");
});

test("the compose's own write is not a later edit", () => {
  // NON-VACUITY: the compose route stamps composedAt and THEN writes the row, so
  // without the grace window every reloaded session would show a fresh spec as
  // stale. Inside the window: current. Outside it: stale.
  assert.equal(specVintage({ composedAt: at(T), briefUpdatedAt: at(T + SPEC_VINTAGE_GRACE_MS) }), "current");
  assert.equal(specVintage({ composedAt: at(T), briefUpdatedAt: at(T + SPEC_VINTAGE_GRACE_MS + 1) }), "stale");
});

test("an unreadable vintage says nothing rather than guessing", () => {
  assert.equal(specVintage({ composedAt: null, briefUpdatedAt: at(T) }), "unknown");
  assert.equal(specVintage({ composedAt: at(T), briefUpdatedAt: null }), "unknown");
  assert.equal(specVintage({ composedAt: undefined, briefUpdatedAt: undefined }), "unknown");
  assert.equal(specVintage({ composedAt: "", briefUpdatedAt: at(T) }), "unknown");
  assert.equal(specVintage({ composedAt: "not a date", briefUpdatedAt: at(T) }), "unknown");
  assert.equal(specVintage({ composedAt: at(T), briefUpdatedAt: "yesterday" }), "unknown");
});
