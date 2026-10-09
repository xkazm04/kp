import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeFixture,
  activeVariant,
  COHORT_POLL_FAILURE_LIMIT,
  isCohortFixtureMode,
  orderCards,
  parseFixtureParam,
  parseVariantParam,
  shouldPollCohort,
} from "./cohortShell.ts";
import type { CohortMember } from "./cohortTypes.ts";

test("the variant inbox adopts a known variant and nothing else", () => {
  assert.equal(parseVariantParam("lineup"), "lineup");
  assert.equal(parseVariantParam("v1"), "v1");
  assert.equal(parseVariantParam("Lineup"), null);
  assert.equal(parseVariantParam(""), null);
  assert.equal(parseVariantParam(null), null);
});

test("the fixture inbox knows live, done and running", () => {
  assert.equal(parseFixtureParam("live"), "live");
  assert.equal(parseFixtureParam("running"), "running");
  assert.equal(parseFixtureParam("failed"), null);
  assert.equal(isCohortFixtureMode(3), false);
});

test("production shows the baseline form and live data whatever was chosen", () => {
  assert.equal(activeVariant(false, "loom"), "v1");
  assert.equal(activeVariant(true, "loom"), "loom");
  assert.equal(activeFixture(false, "done"), "live");
  assert.equal(activeFixture(true, "running"), "running");
});

test("the live view polls while queued or running and stops on a terminal state", () => {
  assert.equal(shouldPollCohort({ status: null, notFound: false, failures: 0 }), true);
  assert.equal(shouldPollCohort({ status: "queued", notFound: false, failures: 0 }), true);
  assert.equal(shouldPollCohort({ status: "running", notFound: false, failures: 1 }), true);
  assert.equal(shouldPollCohort({ status: "done", notFound: false, failures: 0 }), false);
  assert.equal(shouldPollCohort({ status: "failed", notFound: false, failures: 0 }), false);
});

test("a missing cohort stops at once; transient failures stop at the limit", () => {
  assert.equal(shouldPollCohort({ status: "running", notFound: true, failures: 0 }), false);
  assert.equal(shouldPollCohort({ status: "running", notFound: false, failures: COHORT_POLL_FAILURE_LIMIT - 1 }), true);
  assert.equal(shouldPollCohort({ status: "running", notFound: false, failures: COHORT_POLL_FAILURE_LIMIT }), false);
});

const m = (memberId: string, fitRank: number | null, neutralIndex: number): CohortMember =>
  ({ memberId, fitRank, neutralIndex }) as CohortMember;

test("the card list reads by fit rank, the unrated at the end by neutral position", () => {
  const ordered = orderCards([m("pending-b", null, 4), m("third", 3, 0), m("first", 1, 9), m("pending-a", null, 1), m("second", 2, 5)]);
  assert.deepEqual(
    ordered.map((x) => x.memberId),
    ["first", "second", "third", "pending-a", "pending-b"]
  );
});

test("orderCards leaves its input untouched", () => {
  const input = [m("b", 2, 0), m("a", 1, 1)];
  orderCards(input);
  assert.deepEqual(input.map((x) => x.memberId), ["b", "a"]);
});
