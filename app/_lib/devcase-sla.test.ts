import { test } from "node:test";
import assert from "node:assert/strict";
import { lifecycleStall, STALE_COLLECTING_DAYS } from "./devcase-sla.ts";

const NOW = Date.parse("2026-06-14T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

test("an open, empty lifecycle older than the threshold is stalled", () => {
  const s = lifecycleStall({ stage: "collecting", updatedAt: daysAgo(10), createdAt: daysAgo(12), submissionCount: 0 }, NOW);
  assert.equal(s.stalled, true);
  assert.equal(s.ageDays, 10); // measured from updatedAt
});

test("a fresh open lifecycle is not stalled", () => {
  const s = lifecycleStall({ stage: "collecting", updatedAt: daysAgo(2), createdAt: daysAgo(3), submissionCount: 0 }, NOW);
  assert.equal(s.stalled, false);
  assert.equal(s.ageDays, 2);
});

test("any submission clears the stall regardless of age", () => {
  const s = lifecycleStall({ stage: "collecting", updatedAt: daysAgo(30), createdAt: daysAgo(30), submissionCount: 1 }, NOW);
  assert.deepEqual(s, { stalled: false, ageDays: null });
});

test("non-open stages never stall (they've moved on or not gone live)", () => {
  for (const stage of ["intake", "designed", "ranked", "promoted"]) {
    assert.equal(lifecycleStall({ stage, updatedAt: daysAgo(30), createdAt: daysAgo(30), submissionCount: 0 }, NOW).stalled, false);
  }
});

test("published-but-empty is treated as open and can stall", () => {
  assert.equal(lifecycleStall({ stage: "published", updatedAt: daysAgo(9), createdAt: daysAgo(9), submissionCount: 0 }, NOW).stalled, true);
});

test("falls back to createdAt when updatedAt is missing, and tolerates a bad date", () => {
  assert.equal(lifecycleStall({ stage: "collecting", updatedAt: null, createdAt: daysAgo(8), submissionCount: 0 }, NOW).stalled, true);
  assert.deepEqual(lifecycleStall({ stage: "collecting", updatedAt: "not-a-date", createdAt: "also-bad", submissionCount: 0 }, NOW), {
    stalled: false,
    ageDays: null,
  });
});

test("the threshold is configurable and defaults to the documented constant", () => {
  assert.equal(STALE_COLLECTING_DAYS, 7);
  assert.equal(lifecycleStall({ stage: "collecting", updatedAt: daysAgo(4), createdAt: daysAgo(4), submissionCount: 0 }, NOW, 3).stalled, true);
});
