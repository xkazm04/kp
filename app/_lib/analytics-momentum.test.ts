import { test } from "node:test";
import assert from "node:assert/strict";
import { MOMENTUM_EVENT_KINDS, MOMENTUM_WEEKS, weeklyMomentum } from "./analytics-momentum.ts";

const NOW = Date.parse("2026-06-10T12:00:00.000Z");
const DAY = 86_400_000;

function ev(kind: string, daysAgo: number, toStage: string | null = null) {
  return { kind, toStage, createdAt: new Date(NOW - daysAgo * DAY).toISOString() };
}

test("buckets land in the right rolling week, newest last", () => {
  const out = weeklyMomentum(
    [ev("added", 1), ev("added", 2), ev("added", 10)],
    { weeks: 2, now: NOW }
  );
  assert.equal(out.length, 2);
  // 10 days ago → first (older) bucket; 1-2 days ago → last bucket.
  assert.equal(out[0].added, 1);
  assert.equal(out[1].added, 2);
});

test("series mapping: creation kinds, advances, hires and both reject kinds", () => {
  const out = weeklyMomentum(
    [
      ev("added", 1),
      ev("intake_degraded", 1),
      ev("advanced", 1, "Interview"),
      ev("advanced", 1, "Hired"),
      ev("rejected", 1),
      ev("auto_rejected", 1),
      // Kinds outside the mapping are ignored even if fetched.
      ev("applied", 1),
      ev("matched", 1),
      ev("moved", 1, "Screened"),
    ],
    { weeks: 1, now: NOW }
  );
  assert.deepEqual(out[0], { weekStart: out[0].weekStart, added: 2, advanced: 1, rejected: 2, hired: 1 });
});

test("a hire counts as hired, never double-counted as an advance", () => {
  const out = weeklyMomentum([ev("advanced", 3, "Hired")], { weeks: 1, now: NOW });
  assert.equal(out[0].hired, 1);
  assert.equal(out[0].advanced, 0);
});

test("out-of-span and malformed timestamps are skipped, not thrown", () => {
  const out = weeklyMomentum(
    [ev("added", 100), { kind: "added", toStage: null, createdAt: "not-a-date" }],
    { weeks: 2, now: NOW }
  );
  assert.equal(out[0].added + out[1].added, 0);
});

test("defaults: MOMENTUM_WEEKS buckets, ISO-date labels", () => {
  const out = weeklyMomentum([], { now: NOW });
  assert.equal(out.length, MOMENTUM_WEEKS);
  for (const w of out) assert.match(w.weekStart, /^\d{4}-\d{2}-\d{2}$/);
});

test("the exported kind list covers exactly what the mapping reads", () => {
  assert.deepEqual(
    [...MOMENTUM_EVENT_KINDS].sort(),
    ["added", "advanced", "auto_rejected", "intake_degraded", "rejected"]
  );
});
