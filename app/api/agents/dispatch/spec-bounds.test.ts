import { test } from "node:test";
import assert from "node:assert/strict";
import { boundedBudget, boundedTurns, MAX_TURNS_CEILING } from "./spec-bounds.ts";

// ONE rule, TWO projections onto the same DispatchSpec, and only one of them used
// to carry it. `mergedSpec` (the job path) clamped maxTurns to <= 1000 and the
// route 400s a `budgetUsd` that is present but not a non-negative finite number —
// "the one number here that costs money if it is wrong". `specFromAppMaster` (the
// App-master path) checked maxTurns > 0 with NO ceiling and the budget for
// Number.isFinite ONLY, and the codegen'd contract bounds neither
// (`maxTurns: z.number().nullish()`, `monthlyUsd: z.number()`) — so a composed spec
// with 5_000_000 turns and a negative monthly cap validated and reached the wire.
//
// Both are SPEND controls: a turn is a paid model call and the budget is the
// monthly ceiling the executor reserves against.

test("boundedTurns accepts a real turn ceiling and nothing else", () => {
  assert.equal(boundedTurns(40), 40);
  assert.equal(boundedTurns(1), 1);
  assert.equal(boundedTurns(MAX_TURNS_CEILING), MAX_TURNS_CEILING, "the ceiling itself is allowed");

  // The App-master gap: past the ceiling is DROPPED, not clamped to it. Absence
  // means "no ceiling declared" — honest — where clamping would invent a limit
  // nobody chose, and 5_000_000 would be a spend authorization nobody gave.
  assert.equal(boundedTurns(MAX_TURNS_CEILING + 1), null);
  assert.equal(boundedTurns(5_000_000), null);

  for (const bad of [0, -1, 2.5, NaN, Infinity, -Infinity, "40", null, undefined, {}, [40]]) {
    assert.equal(boundedTurns(bad), null, `${String(bad)} is not a turn ceiling`);
  }
});

test("boundedBudget accepts a real monthly cap and nothing else", () => {
  assert.equal(boundedBudget(120), 120);
  assert.equal(boundedBudget(0), 0, "zero is a real cap — spend nothing — not an absent one");
  assert.equal(boundedBudget(99.5), 99.5);

  // The App-master gap: Number.isFinite alone admitted a NEGATIVE cap, which is
  // not a spend limit in any reading.
  assert.equal(boundedBudget(-5), null);
  for (const bad of [NaN, Infinity, -Infinity, "120", null, undefined, {}, [120]]) {
    assert.equal(boundedBudget(bad), null, `${String(bad)} is not a monthly cap`);
  }
});
