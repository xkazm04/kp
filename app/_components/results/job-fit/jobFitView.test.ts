/*
 * hiddenByCap — the "+N more" arithmetic behind every capped list in the
 * job-fit tab, pinned. It was a private function inside JobFitTab.tsx, and its
 * whole value is in the two edge cases nobody can see from the JSX: a NULL
 * total (an analysis saved before total-tracking existed) must read as
 * "unknown" and show nothing, and a total BELOW what was shown (a corrupt or
 * re-capped payload) must never render "+-3 more".
 *
 * Non-vacuity: written before jobFitView.ts existed — red on a missing module.
 * Runner: node:test — `npm run test:unit`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { hiddenByCap } from "./jobFitView.ts";

test("the ordinary case is total minus shown", () => {
  assert.equal(hiddenByCap(12, 5), 7);
});

test("a list the cap did not touch hides nothing", () => {
  assert.equal(hiddenByCap(5, 5), 0);
});

test("an unknown total hides nothing rather than guessing", () => {
  // Analyses predating KeywordCoverage.total carry null/undefined. Guessing
  // would invent a "+N more" for entries that were never dropped.
  assert.equal(hiddenByCap(null, 5), 0);
  assert.equal(hiddenByCap(undefined, 5), 0);
});

test("a total smaller than what was shown clamps at zero, never negative", () => {
  assert.equal(hiddenByCap(3, 5), 0);
});
