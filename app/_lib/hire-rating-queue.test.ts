// challenge-r07 pipeline-api/B — the fold behind "rated X of Y hires" on Analytics →
// Quality, and the queue of unrated hires it now lists in place.
//
// Pure: no DB, no route. The unit-DB half (the roster read and the GET/POST round
// trip) lives beside the route, in app/api/pipeline/outcomes/outcomes-route.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QUEUE_CAP,
  foldHireRatingQueue,
  queueHeadline,
  type HireRosterRow,
  type LatestHireOutcome,
} from "./hire-rating-queue.ts";

function hire(id: string, hiredAt: string | null): HireRosterRow {
  return { entryId: id, ref: `ref-${id}`, candidateLabel: `Candidate ${id}`, jobTitle: `Role ${id}`, hiredAt };
}
const A = hire("A", "2026-05-01T09:00:00.000Z");
const B = hire("B", "2026-07-01T09:00:00.000Z");
const C = hire("C", "2026-08-01T09:00:00.000Z");
const rated = (performance: number | null, outcome = "hired"): LatestHireOutcome => ({ outcome, performance });

test("a rated hire is counted once; the unrated ones queue oldest hire first", () => {
  // Handed newest-first on purpose: the order is the fold's, not the caller's.
  const q = foldHireRatingQueue([C, A, B], new Map([[A.ref, rated(4)]]));
  assert.equal(q.hires, 3);
  assert.equal(q.rated, 1);
  assert.equal(q.unratedTotal, 2);
  assert.deepEqual(
    q.unrated.map((r) => r.entryId),
    ["B", "C"],
    "the longest-serving unrated hire is the one whose on-the-job outcome is knowable, so it leads"
  );
});

test("numerator and denominator are the same population: a rating on no current hire's ref does not count", () => {
  // X is a dev-case-lane rating, or a hire since moved off the terminal column. The
  // old counter (countRatedHires) answered 1 here, so Quality read "1 of 1 hires rated".
  const q = foldHireRatingQueue([A], new Map([["ref-X", rated(5)]]));
  assert.equal(q.rated, 0);
  assert.deepEqual(q.unrated.map((r) => r.entryId), ["A"]);
});

test("invariant: rated never exceeds hires, and rated + unratedTotal === hires, over any input", () => {
  const roster = [A, B, C];
  const outcomes = new Map<string, LatestHireOutcome>([
    [A.ref, rated(2)],
    [C.ref, rated(5)],
    ["ref-X", rated(3)],
    ["ref-Y", rated(1)],
    ["ref-Z", rated(4)],
  ]);
  for (let take = 0; take <= roster.length; take += 1) {
    const q = foldHireRatingQueue(roster.slice(0, take), outcomes);
    assert.ok(q.rated <= q.hires, `rated ${q.rated} > hires ${q.hires}`);
    assert.equal(q.rated + q.unratedTotal, q.hires);
  }
});

test("a null performance, or an outcome other than 'hired', leaves the hire unrated - never a zero", () => {
  const q = foldHireRatingQueue(
    [A, B, C],
    new Map([
      [A.ref, rated(null)],
      [B.ref, rated(4, "rejected")],
      [C.ref, rated(0 as number, "left")],
    ])
  );
  assert.equal(q.rated, 0);
  assert.deepEqual(q.unrated.map((r) => r.entryId), ["A", "B", "C"]);
});

test("40 unrated hires: the queue is capped at QUEUE_CAP, the total is not, and a row names a person, never a judgement", () => {
  assert.equal(QUEUE_CAP, 25);
  const roster = Array.from({ length: 40 }, (_, i) => hire(`h${String(i).padStart(2, "0")}`, `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`));
  const q = foldHireRatingQueue(roster, new Map());
  assert.equal(q.unrated.length, QUEUE_CAP);
  assert.equal(q.unratedTotal, 40);
  for (const row of q.unrated) {
    assert.deepEqual(Object.keys(row).sort(), ["candidateLabel", "entryId", "hiredAt", "jobTitle"]);
  }
});

test("a hire with no stamp cannot be placed in time: it queues after every dated hire", () => {
  const undated = hire("U", null);
  const q = foldHireRatingQueue([undated, C, A], new Map());
  assert.deepEqual(q.unrated.map((r) => r.entryId), ["A", "C", "U"]);
});

test("queueHeadline: the Quality line's three states, off the one fold", () => {
  assert.deepEqual(queueHeadline({ hires: 0, rated: 0, minOutcomes: 20 }), { state: "none", queueOpen: false });
  // Enough ratings for a curve: the line says so, and the queue stays offered, collapsed.
  assert.deepEqual(queueHeadline({ hires: 30, rated: 20, minOutcomes: 20 }), { state: "ready", rated: 20, queueOpen: false });
  assert.deepEqual(queueHeadline({ hires: 6, rated: 2, minOutcomes: 20 }), {
    state: "pending",
    rated: 2,
    hires: 6,
    remaining: 18,
    queueOpen: true,
  });
});
