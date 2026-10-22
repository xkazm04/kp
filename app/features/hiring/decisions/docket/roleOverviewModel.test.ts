import assert from "node:assert/strict";
import { test } from "node:test";
import type { RoleViewCandidate } from "@/app/_lib/role-decision-view";
import type { Entry } from "@/app/features/shared/decisionsTypes";
import {
  canCompareShortlist,
  nextOverviewSort,
  OVERVIEW_COLS,
  OVERVIEW_SORT,
  overviewRows,
  pruneShortlist,
  rosterGroups,
  shortlistSelection,
  sortOverview,
  toggleShortlist,
  type OverviewRow,
} from "./roleOverviewModel";

const cand = (id: string, o: { match?: number | null; ws?: number | null; iv?: number | null; stage?: string; label?: string } = {}): RoleViewCandidate => ({
  entryId: id,
  candidateLabel: o.label ?? id,
  stage: o.stage ?? "Screened",
  match: o.match == null ? { score: null, provenance: null, reason: "not_scored" } : { score: o.match, provenance: { source: "snapshot" }, reason: null },
  workSample:
    o.ws == null
      ? { transferScore: null, reason: "not_sent", source: null, grading: null, ladder: null }
      : { transferScore: o.ws, reason: null, source: "submission", grading: "template", ladder: null },
  interview: {
    human: o.iv == null ? { average: null, count: 0, reason: "no_scorecard" } : { average: o.iv, count: 1, reason: null },
    ai: { average: null, count: 0, reason: "no_scorecard" },
    scale: 5,
  },
});

const AXIS = ["Applied", "Screened", "Interview", "Offer", "Hired"];
const ids = (rows: readonly OverviewRow[]) => rows.map((r) => r.entryId);

const rows = overviewRows(
  [cand("a", { match: 70, ws: null, iv: 4 }), cand("b", { match: null, ws: 0, iv: null, stage: "Offer" }), cand("c", { match: 90, ws: 55 }), cand("d", { match: 70, ws: 80, iv: 3.5, stage: "Interview" })],
  new Map([["c", "advance" as const]]),
  AXIS,
);

test("each column sorts on its own; an unscored cell sorts last in BOTH directions, never as 0", () => {
  assert.deepEqual(ids(sortOverview(rows, { col: "match", dir: "desc" })), ["c", "a", "d", "b"]);
  assert.deepEqual(ids(sortOverview(rows, { col: "match", dir: "asc" })), ["a", "d", "c", "b"], "b (never scored) stays last ascending");
  // A real 0 on the work sample is a score and sorts as one; "not sent" sorts after it.
  assert.deepEqual(ids(sortOverview(rows, { col: "workSample", dir: "asc" })), ["b", "c", "d", "a"]);
  assert.deepEqual(ids(sortOverview(rows, { col: "workSample", dir: "desc" })), ["d", "c", "b", "a"]);
  assert.deepEqual(ids(sortOverview(rows, { col: "interview", dir: "desc" })), ["a", "d", "b", "c"]);
  assert.deepEqual(ids(sortOverview(rows, { col: "stage", dir: "desc" })), ["b", "d", "a", "c"], "furthest along first");
  assert.deepEqual(ids(sortOverview(rows, { col: "proposal", dir: "desc" })), ["c", "a", "b", "d"], "a waiting proposal first, the rest in view order");
});

test("the sort is stable: ties keep the view's order, and the input is not mutated", () => {
  const before = ids(rows);
  assert.deepEqual(ids(sortOverview(rows, { col: "match", dir: "desc" })).slice(1, 3), ["a", "d"]);
  assert.deepEqual(ids(sortOverview(rows, { col: "match", dir: "asc" })).slice(0, 2), ["a", "d"]);
  assert.deepEqual(ids(rows), before);
});

test("no column blends the parts: there is no total to sort by", () => {
  assert.deepEqual([...OVERVIEW_COLS].sort(), Object.keys(OVERVIEW_SORT).sort());
  for (const col of OVERVIEW_COLS) assert.ok(!/total|blend|overall/i.test(col));
});

test("the columns read who, stage, match, interview, work sample, proposal, each once", () => {
  assert.deepEqual([...OVERVIEW_COLS], ["candidate", "stage", "match", "interview", "workSample", "proposal"]);
  assert.equal(new Set(OVERVIEW_COLS).size, OVERVIEW_COLS.length);
});

test("a click on the same column flips it, a new column opens numbers-high-first and names A-Z", () => {
  assert.deepEqual(nextOverviewSort({ col: "match", dir: "desc" }, "match"), { col: "match", dir: "asc" });
  assert.deepEqual(nextOverviewSort({ col: "match", dir: "asc" }, "candidate"), { col: "candidate", dir: "asc" });
  assert.deepEqual(nextOverviewSort({ col: "candidate", dir: "asc" }, "workSample"), { col: "workSample", dir: "desc" });
});

test("the shortlist: tick and untick, a cap, pruning of people who left, and the hand-off order", () => {
  let s: ReadonlySet<string> = new Set();
  assert.equal(canCompareShortlist(s), false);
  s = toggleShortlist(s, "a", 3);
  assert.equal(canCompareShortlist(s), false, "one person is not a comparison");
  s = toggleShortlist(s, "d", 3);
  s = toggleShortlist(s, "c", 3);
  assert.equal(canCompareShortlist(s), true);
  const capped = toggleShortlist(s, "b", 3);
  assert.equal(capped, s, "a tick past the cap is ignored");
  s = toggleShortlist(s, "a", 3);
  assert.deepEqual([...s].sort(), ["c", "d"]);
  // The hand-off follows the table's current order, not the tick order.
  assert.deepEqual(shortlistSelection(s, sortOverview(rows, { col: "match", dir: "desc" })), ["c", "d"]);
  assert.deepEqual(shortlistSelection(s, sortOverview(rows, { col: "workSample", dir: "desc" })), ["d", "c"]);
  const pruned = pruneShortlist(s, ["c", "x"]);
  assert.deepEqual([...pruned], ["c"]);
  assert.equal(pruneShortlist(pruned, ["c"]), pruned, "nothing to prune keeps the same set");
});

test("every role with an active candidate is on the roster; closed-out roles are not", () => {
  const e = (id: string, jobId: string | null, title: string | null, stage: string, status = "active") =>
    ({ id, jobId, jobTitle: title, stage, status, candidateLabel: id }) as unknown as Entry;
  const groups = rosterGroups(
    [e("1", "j2", "Zeta", "Screened"), e("2", "j1", "Alpha", "Applied"), e("3", "j1", "Alpha", "Hired"), e("4", "j3", "Closed", "Screened", "role_closed"), e("5", null, null, "Applied")],
    new Set(["Hired"]),
    "Unassigned",
    "en",
  );
  assert.deepEqual(groups.map((g) => [g.roleKey, g.roleTitle, g.entries.map((x) => x.id)]), [
    ["j1", "Alpha", ["2"]],
    ["unassigned", "Unassigned", ["5"]],
    ["j2", "Zeta", ["1"]],
  ]);
});
