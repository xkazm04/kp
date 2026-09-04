import { test } from "node:test";
import assert from "node:assert/strict";
import { MOMENTUM_EVENT_KINDS, MOMENTUM_WEEKS, momentumWeekLabel, weeklyMomentum } from "./analytics-momentum.ts";

const NOW = Date.parse("2026-06-10T12:00:00.000Z");
const DAY = 86_400_000;

function ev(kind: string, daysAgo: number, toStage: string | null = null) {
  return { kind, toStage, createdAt: new Date(NOW - daysAgo * DAY).toISOString() };
}

test("buckets land in the right rolling week, newest last", () => {
  const out = weeklyMomentum(
    [ev("added", 1), ev("added", 2), ev("added", 10)],
    { weeks: 2, now: NOW, terminalStage: "Hired" }
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
    { weeks: 1, now: NOW, terminalStage: "Hired" }
  );
  assert.deepEqual(out[0], { weekStart: out[0].weekStart, added: 2, advanced: 1, rejected: 2, hired: 1 });
});

test("a hire counts as hired, never double-counted as an advance", () => {
  const out = weeklyMomentum([ev("advanced", 3, "Hired")], { weeks: 1, now: NOW, terminalStage: "Hired" });
  assert.equal(out[0].hired, 1);
  assert.equal(out[0].advanced, 0);
});

test("out-of-span and malformed timestamps are skipped, not thrown", () => {
  const out = weeklyMomentum(
    [ev("added", 100), { kind: "added", toStage: null, createdAt: "not-a-date" }],
    { weeks: 2, now: NOW, terminalStage: "Hired" }
  );
  assert.equal(out[0].added + out[1].added, 0);
});

test("defaults: MOMENTUM_WEEKS buckets, ISO-date labels", () => {
  const out = weeklyMomentum([], { now: NOW, terminalStage: "Hired" });
  assert.equal(out.length, MOMENTUM_WEEKS);
  for (const w of out) assert.match(w.weekStart, /^\d{4}-\d{2}-\d{2}$/);
});

test("momentumWeekLabel renders the weekStart's UTC day, stable across timezones", () => {
  // weekStart is a UTC calendar date. The label must show THAT day (14 Jul), not the
  // day a LOCAL parse of "2026-07-14T00:00:00" would land on for a client west of UTC.
  assert.equal(momentumWeekLabel("2026-07-14", "en"), "Jul 14");
  // A date whose UTC midnight falls on the PREVIOUS local day for any west-of-UTC client
  // (the exact off-by-one the fix targets): the day stays 1, never rolls back to prior month.
  assert.equal(momentumWeekLabel("2026-07-01", "en"), "Jul 1");
  // The pin to UTC is explicit and locale-aware (day + short month), never a full datetime.
  assert.match(momentumWeekLabel("2026-01-05", "en"), /Jan 5/);
});

test("the exported kind list covers exactly what the mapping reads", () => {
  assert.deepEqual(
    [...MOMENTUM_EVENT_KINDS].sort(),
    ["added", "advanced", "auto_advanced", "auto_rejected", "intake_degraded", "rejected"]
  );
});

test("the hire series follows the workspace's OWN terminal column", () => {
  // A board whose final column is "Signed". The move into it is a hire; the move into
  // the shipped name is just another advance on this board (no such column exists).
  const out = weeklyMomentum(
    [ev("advanced", 1, "Signed"), ev("advanced", 1, "Hired"), ev("auto_advanced", 1, "Signed")],
    { weeks: 1, now: NOW, terminalStage: "Signed" }
  );
  assert.equal(out[0].hired, 2, "both moves into the workspace's terminal column count as hires");
  assert.equal(out[0].advanced, 1, "a move into a column this board does not have is not a hire");
});
