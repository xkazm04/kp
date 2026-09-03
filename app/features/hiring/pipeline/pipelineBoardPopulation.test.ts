// The board's POPULATION predicate — who the header counts and who the rail names.
//
// THE BUG THIS PINS. Two surfaces stacked one above the other answered "how many
// candidates are live on this board" with two different predicates and neither was
// tested:
//   - PipelineTodayRail counted REAL (non-sim) rows whose `status === "active"`;
//   - usePipelineTabState's `activeCount` counted EVERY row not standing on a
//     terminal-role stage — sim residue from the guided demo included, and every
//     rejected/withdrawn candidate still parked on "Screened" included.
// So a board mid-demo, or one with a few rejections that had not been moved, showed
// "Active 14" over a rail that named four people, and the aging chip aged rows the
// rail had already written off. One question, two answers, on the same screen.
//
// boardPopulation is now the ONE predicate; deriveRailRows buckets off it. Both the
// header and the rail read them, so they cannot disagree again.
//
// Runner: node:test via `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boardPopulation, deriveRailRows } from "./pipelineBoardPopulation.ts";
import { DEFAULT_STAGE_AXIS } from "@/app/_lib/pipeline-stages.ts";
import type { Entry } from "@/app/features/shared/pipelineTypes.ts";

const NOW = Date.parse("2026-09-03T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

let seq = 0;
function entry(over: Partial<Entry> = {}): Entry {
  seq += 1;
  return {
    id: `e${seq}`,
    candidateLabel: `C${seq}`,
    jobTitle: "Backend Engineer",
    stage: "Accepted",
    status: "active",
    stageChangedAt: daysAgo(1),
    approvalKind: null,
    ...over,
  } as Entry;
}

test("boardPopulation: the demo's own rows are never counted as real hiring data", () => {
  const p = boardPopulation([entry(), entry({ jobTitle: "Backend Engineer (SIM)" })]);
  assert.equal(p.real.length, 1);
  assert.equal(p.active.length, 1);
  assert.equal(p.real[0].jobTitle, "Backend Engineer");
});

test("boardPopulation: a rejected candidate still parked on a live column is NOT active", () => {
  // The exact row the header used to count and the rail did not: status says the
  // funnel is done with them, the stage has simply not been moved.
  const p = boardPopulation([entry({ status: "rejected", stage: "Screened" }), entry()]);
  assert.equal(p.real.length, 2, "a rejected candidate is still a real row");
  assert.equal(p.active.length, 1, "…but not a live one");
});

test("boardPopulation: a null/absent job title is real data, not sim residue", () => {
  const p = boardPopulation([entry({ jobTitle: null as unknown as string })]);
  assert.equal(p.real.length, 1);
});

test("boardPopulation: null entries are an empty population, never a throw", () => {
  assert.deepEqual(boardPopulation(null), { real: [], active: [] });
  assert.deepEqual(boardPopulation(undefined), { real: [], active: [] });
});

test("deriveRailRows: buckets by approval gate and stage ROLE, non-empty only, in order", () => {
  const rows = deriveRailRows(
    [
      entry({ stage: "Accepted" }), // inbound (entry role)
      entry({ stage: "Interview", approvalKind: "scorecard_review" }),
      entry({ stage: "Offer", approvalKind: "offer_review" }),
      entry({ stage: "Interview", approvalKind: "calendar" }),
      entry({ stage: "Offer" }), // offer out, no gate pending
      entry({ stage: "Hired", stageChangedAt: daysAgo(2) }),
    ],
    DEFAULT_STAGE_AXIS,
    NOW
  );
  assert.deepEqual(
    rows.map((r) => r.key),
    ["inbound", "scorecards", "offerReviews", "awaitingSlot", "offersOut", "hired"]
  );
  for (const r of rows) assert.equal(r.entries.length, 1, `${r.key} holds exactly its one row`);
});

test("deriveRailRows: an offer awaiting YOUR review is not counted as an offer OUT", () => {
  const rows = deriveRailRows([entry({ stage: "Offer", approvalKind: "offer_review" })], DEFAULT_STAGE_AXIS, NOW);
  assert.deepEqual(rows.map((r) => r.key), ["offerReviews"]);
});

test("deriveRailRows: 'hired this week' is a 7-day window, and the boundary is inclusive", () => {
  const keys = (days: number) =>
    deriveRailRows([entry({ stage: "Hired", stageChangedAt: daysAgo(days) })], DEFAULT_STAGE_AXIS, NOW).map((r) => r.key);
  assert.deepEqual(keys(7), ["hired"]);
  assert.deepEqual(keys(8), [], "an older hire is history, not this week's news");
});

test("deriveRailRows: a hire is shown even though `status` is no longer active", () => {
  // The hired bucket reads `real`, not `active` — a hire's status legitimately
  // leaves "active" while the celebration is still this week's news.
  const rows = deriveRailRows([entry({ stage: "Hired", status: "hired", stageChangedAt: daysAgo(1) })], DEFAULT_STAGE_AXIS, NOW);
  assert.deepEqual(rows.map((r) => r.key), ["hired"]);
});

test("deriveRailRows: sim rows never reach any bucket", () => {
  const rows = deriveRailRows(
    [entry({ jobTitle: "Backend Engineer (SIM)", stage: "Accepted" })],
    DEFAULT_STAGE_AXIS,
    NOW
  );
  assert.deepEqual(rows, []);
});

test("deriveRailRows: a quiet board produces no rows at all", () => {
  assert.deepEqual(deriveRailRows([], DEFAULT_STAGE_AXIS, NOW), []);
  assert.deepEqual(deriveRailRows(null, DEFAULT_STAGE_AXIS, NOW), []);
});
