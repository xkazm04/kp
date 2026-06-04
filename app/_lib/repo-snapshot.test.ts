// Pins the commit-cadence "bursty" heuristic (idea-b3b254d6). The old rule compared a duration
// in hours against a commit count (`spanHours <= Math.max(6, times.length)`) — a unit mismatch
// no one could tune. The replacement is a named, unit-correct rule, locked here with a clearly
// bursty fixture (a cluster in one sitting) and a clearly spread-out one (commits over weeks).
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BURSTY_MIN_COMMITS,
  BURSTY_WINDOW_HOURS,
  summarizeCadence,
} from "./repo-snapshot.ts";

const at = (iso: string) => ({ date: iso });

// ---------------------------------------------------------------------------
// The named rule.
// ---------------------------------------------------------------------------

test("the rule constants are the documented 6h window / 3-commit minimum", () => {
  assert.equal(BURSTY_WINDOW_HOURS, 6);
  assert.equal(BURSTY_MIN_COMMITS, 3);
});

// ---------------------------------------------------------------------------
// Clearly bursty: a real cluster inside one sitting.
// ---------------------------------------------------------------------------

test("4 commits within ~2 hours is bursty", () => {
  const cadence = summarizeCadence([
    at("2026-01-10T09:00:00.000Z"),
    at("2026-01-10T09:30:00.000Z"),
    at("2026-01-10T10:15:00.000Z"),
    at("2026-01-10T11:00:00.000Z"),
  ]);
  assert.equal(cadence.count, 4);
  assert.equal(cadence.spanHours, 2);
  assert.equal(cadence.bursty, true);
});

test("a cluster spanning exactly the window boundary is bursty (inclusive)", () => {
  const cadence = summarizeCadence([
    at("2026-01-10T09:00:00.000Z"),
    at("2026-01-10T12:00:00.000Z"),
    at("2026-01-10T15:00:00.000Z"), // exactly 6h after the first
  ]);
  assert.equal(cadence.spanHours, BURSTY_WINDOW_HOURS);
  assert.equal(cadence.bursty, true);
});

// ---------------------------------------------------------------------------
// Clearly NOT bursty.
// ---------------------------------------------------------------------------

test("commits spread across weeks are not bursty", () => {
  const cadence = summarizeCadence([
    at("2026-01-01T09:00:00.000Z"),
    at("2026-01-08T14:00:00.000Z"),
    at("2026-01-15T11:00:00.000Z"),
    at("2026-01-23T16:00:00.000Z"),
  ]);
  assert.equal(cadence.count, 4);
  assert.ok((cadence.spanHours ?? 0) > BURSTY_WINDOW_HOURS);
  assert.equal(cadence.bursty, false);
});

test("a tight pair is NOT bursty — below the minimum-commit floor", () => {
  // Two commits an hour apart fits the window but isn't a genuine cluster, so the
  // count floor keeps it from being labelled bursty.
  const cadence = summarizeCadence([
    at("2026-01-10T09:00:00.000Z"),
    at("2026-01-10T10:00:00.000Z"),
  ]);
  assert.equal(cadence.spanHours, 1);
  assert.equal(cadence.bursty, false);
});

// ---------------------------------------------------------------------------
// Degenerate inputs: too few dated commits to judge.
// ---------------------------------------------------------------------------

test("fewer than two dated commits yields null span and null bursty", () => {
  assert.deepEqual(summarizeCadence([]), { count: 0, spanHours: null, bursty: null });
  assert.deepEqual(summarizeCadence([at("2026-01-10T09:00:00.000Z")]), {
    count: 1,
    spanHours: null,
    bursty: null,
  });
});

test("undated commits are ignored for span/bursty but still counted", () => {
  const cadence = summarizeCadence([
    at("2026-01-10T09:00:00.000Z"),
    at(""), // no date — counted, but contributes no timestamp
    at("not-a-date"),
  ]);
  assert.equal(cadence.count, 3); // every commit counts
  assert.equal(cadence.spanHours, null); // only one parseable date → no span
  assert.equal(cadence.bursty, null);
});
