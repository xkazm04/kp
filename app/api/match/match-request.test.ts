// The /api/match input boundary. Both helpers guard an argv that reaches a Python
// process: the limit becomes `--limit <n>` (a float there is an opaque TypeError, a
// 0 returns nothing while meta still reports survivors) and the weights become
// `--weights <json>`. Pinned here because the route itself cannot be imported by the
// unit runner — it needs a Next request scope.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MATCH_LIMIT_DEFAULT,
  MATCH_LIMIT_MAX,
  MATCH_LIMIT_MIN,
  resolveMatchLimit,
  sanitizeMatchWeights,
} from "./match-request.ts";

test("resolveMatchLimit falls back to the default for anything that is not a finite number", () => {
  for (const raw of [undefined, null, "25", NaN, Infinity, -Infinity, {}, [], true]) {
    assert.equal(resolveMatchLimit(raw), MATCH_LIMIT_DEFAULT, `${String(raw)} must fall back`);
  }
});

test("resolveMatchLimit clamps into 1..200 and floors a float", () => {
  assert.equal(resolveMatchLimit(25), 25);
  assert.equal(resolveMatchLimit(MATCH_LIMIT_MIN), MATCH_LIMIT_MIN);
  assert.equal(resolveMatchLimit(MATCH_LIMIT_MAX), MATCH_LIMIT_MAX);
  // Below the floor: 0 would return an empty ranking, a negative would silently
  // drop the LAST n matches (Python's scored[:-3]).
  assert.equal(resolveMatchLimit(0), MATCH_LIMIT_MIN);
  assert.equal(resolveMatchLimit(-3), MATCH_LIMIT_MIN);
  // Above the ceiling.
  assert.equal(resolveMatchLimit(10_000), MATCH_LIMIT_MAX);
  // Floats floor rather than reaching argv as "12.7".
  assert.equal(resolveMatchLimit(12.7), 12);
  assert.equal(resolveMatchLimit(0.5), MATCH_LIMIT_MIN);
});

test("sanitizeMatchWeights drops non-objects and empty vectors to null", () => {
  for (const raw of [undefined, null, "skills", 3, true, [1, 2, 3], {}, { a: "1", b: NaN }]) {
    assert.equal(sanitizeMatchWeights(raw), null, `${JSON.stringify(raw) ?? String(raw)} must not be forwarded`);
  }
});

test("sanitizeMatchWeights keeps only the finite-number entries", () => {
  const out = sanitizeMatchWeights({ skills: 0.5, seniority: 2, bad: "x", nan: NaN, inf: Infinity, nested: { a: 1 } });
  assert.deepEqual(out, { skills: 0.5, seniority: 2 });
  // Zero and negative are legitimate here: the Python scorer clamps to the
  // archetype's bounds and renormalizes, so this stage must not pre-judge range.
  assert.deepEqual(sanitizeMatchWeights({ skills: 0, seniority: -1 }), { skills: 0, seniority: -1 });
});
