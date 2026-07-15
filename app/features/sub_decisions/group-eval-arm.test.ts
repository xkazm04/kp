// shortlist-to-group-eval — pins the pre-arm URL grammar (?arm=<id,id,…>) shared
// by the Match handoff CTA (builds it) and DecisionsTab (consumes it), plus the
// seed rule that filters a deep-linked selection to the role's LIVE cohort.
// The invariants that matter:
//   - a selection below the comparable pair never arms anything (no dead affordance),
//   - the cap is enforced at build, parse, AND seed time (the server re-enforces),
//   - ids that left the cohort are silently dropped, and junk never round-trips.
//
// Runner: Node's built-in test runner with type stripping. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { GROUP_EVAL_CAP } from "@/app/_lib/group-eval-cohort";
import { buildArmParam, parseArmParam, seedArmSelection } from "./group-eval-arm.ts";

test("build → parse round-trips a valid selection", () => {
  const ids = ["m-cand-a-job1", "m-cand-b-job1", "m-cand-c-job1"];
  assert.deepEqual(parseArmParam(buildArmParam(ids)), ids);
});

test("buildArmParam dedups, drops out-of-shape ids, and caps at GROUP_EVAL_CAP", () => {
  assert.equal(buildArmParam(["a", "a", "b"]), "a,b");
  // Shape guard: separators/quotes/spaces can't ride into the URL grammar.
  assert.equal(buildArmParam(["ok-1", "bad id", "worse,id", "", "ok-2"]), "ok-1,ok-2");
  const many = Array.from({ length: GROUP_EVAL_CAP + 3 }, (_, i) => `id-${i}`);
  assert.equal(buildArmParam(many).split(",").length, GROUP_EVAL_CAP);
});

test("parseArmParam rejects absence, malformed values, and sub-pair selections", () => {
  assert.equal(parseArmParam(null), null);
  assert.equal(parseArmParam(undefined), null);
  assert.equal(parseArmParam(""), null);
  // One valid id is not a comparison.
  assert.equal(parseArmParam("only-one"), null);
  // Junk-only values die at the shape guard.
  assert.equal(parseArmParam("!!!,???"), null);
  // A crafted over-long value is capped, never trusted.
  const many = Array.from({ length: GROUP_EVAL_CAP + 5 }, (_, i) => `id-${i}`).join(",");
  assert.equal(parseArmParam(many)!.length, GROUP_EVAL_CAP);
  // Duplicates collapse — two copies of one id are still not a pair.
  assert.equal(parseArmParam("same,same"), null);
});

test("seedArmSelection keeps only ids in the live cohort and drops sub-pair leftovers", () => {
  const cohort = ["e1", "e2", "e3"];
  // Ids that left the cohort (decided elsewhere) are silently dropped.
  assert.deepEqual(seedArmSelection(["e1", "gone", "e3"], cohort), ["e1", "e3"]);
  // Fewer than a comparable pair survive → no arm at all (never a 1-pick mode).
  assert.deepEqual(seedArmSelection(["e1", "gone"], cohort), []);
  assert.deepEqual(seedArmSelection(null, cohort), []);
  assert.deepEqual(seedArmSelection([], cohort), []);
  // Cap holds even when the whole request is valid.
  const bigCohort = Array.from({ length: GROUP_EVAL_CAP + 4 }, (_, i) => `e${i}`);
  assert.equal(seedArmSelection(bigCohort, bigCohort).length, GROUP_EVAL_CAP);
});
