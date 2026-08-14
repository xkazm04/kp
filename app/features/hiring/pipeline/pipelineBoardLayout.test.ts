// Pure-logic coverage for the board's lane×stage bucketing. No DB, no React — the
// placement rule (each entry in at most one cell, against the axis it is GIVEN;
// an off-axis entry surfaced rather than folded; order preserved) is the
// correctness-critical half of both the memoization refactor that replaced the
// per-cell `lane.filter(...)` and the editable-axis work that followed it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boardVisibleOrder, bucketLaneEntries, offAxisEntries } from "./pipelineBoardLayout.ts";
import { STAGES, type Entry, type Position } from "@/app/features/shared/pipelineTypes";

const pos = (id: string): Position => ({ id, title: id, family: "", count: 0 });
// entryLaneKey uses jobId ?? jobTitle ?? "?" — pin the lane via jobId.
const entry = (id: string, jobId: string, stage: string): Entry =>
  ({ id, jobId, jobTitle: jobId, stage } as unknown as Entry);

const idx = (stage: string) => STAGES.indexOf(stage);

test("each entry lands in exactly its stage column, within its lane", () => {
  const positions = [pos("job-a"), pos("job-b")];
  const entries = [
    entry("a1", "job-a", "Accepted"),
    entry("a2", "job-a", "Interview"),
    entry("b1", "job-b", "Screened"),
  ];
  const cells = bucketLaneEntries(positions, entries);

  assert.deepEqual(cells.get("job-a")![idx("Accepted")].map((e) => e.id), ["a1"]);
  assert.deepEqual(cells.get("job-a")![idx("Interview")].map((e) => e.id), ["a2"]);
  assert.deepEqual(cells.get("job-b")![idx("Screened")].map((e) => e.id), ["b1"]);

  // Total placed count equals the input count — no drops, no duplicates.
  const placed = [...cells.values()].flat().flat().length;
  assert.equal(placed, 3);
});

test("an off-axis stage lands in NO cell — it belongs to the off-axis strip", () => {
  // This used to fold into column 0. That was right while the axis was a
  // compile-time constant (an unknown stage could only be a legacy row, and
  // visible-but-wrong beat invisible). With an editable axis the fold is the
  // worst option available: remove a column and its candidates would silently
  // reappear at the top of the funnel, indistinguishable from a mass reset.
  const positions = [pos("job-a")];
  const cells = bucketLaneEntries(positions, [entry("x", "job-a", "LegacyStage")]);
  const placed = cells.get("job-a")!.flat().map((e) => e.id);
  assert.deepEqual(placed, [], "an off-axis entry occupies no column");
  assert.deepEqual(offAxisEntries([entry("x", "job-a", "LegacyStage")]).map((e) => e.id), ["x"]);
});

test("offAxisEntries reports only genuinely off-axis stages, preserving input order", () => {
  const entries = [
    entry("legacy", "job-a", "LegacyStage"),
    entry("ok", "job-a", "Accepted"),
    entry("retired", "job-a", "Second interview"),
  ];
  assert.deepEqual(offAxisEntries(entries).map((e) => e.id), ["legacy", "retired"]);
  // Against a wider axis, the same entry is on-board and no longer stranded.
  assert.deepEqual(offAxisEntries(entries, [...STAGES, "Second interview"]).map((e) => e.id), ["legacy"]);
});

test("bucketLaneEntries buckets against the axis it is GIVEN, not the shipped one", () => {
  const positions = [pos("job-a")];
  const columns = ["Accepted", "Tech screen", "Onsite", "Hired"];
  const cells = bucketLaneEntries(positions, [entry("t", "job-a", "Tech screen"), entry("o", "job-a", "Onsite")], columns);
  assert.equal(cells.get("job-a")!.length, columns.length, "one cell per given column");
  assert.deepEqual(cells.get("job-a")![1].map((e) => e.id), ["t"]);
  assert.deepEqual(cells.get("job-a")![2].map((e) => e.id), ["o"]);
});

test("order within a cell follows input order", () => {
  const positions = [pos("job-a")];
  const entries = [entry("first", "job-a", "Accepted"), entry("second", "job-a", "Accepted"), entry("third", "job-a", "Accepted")];
  const cells = bucketLaneEntries(positions, entries);
  assert.deepEqual(cells.get("job-a")![idx("Accepted")].map((e) => e.id), ["first", "second", "third"]);
});

test("an entry whose lane isn't rendered is dropped (filtered board)", () => {
  const positions = [pos("job-a")]; // job-b is filtered out
  const cells = bucketLaneEntries(positions, [entry("a1", "job-a", "Accepted"), entry("b1", "job-b", "Accepted")]);
  const placed = [...cells.values()].flat().flat().map((e) => e.id);
  assert.deepEqual(placed, ["a1"]);
});

test("every lane gets a full STAGES-length cell array even with no entries", () => {
  const cells = bucketLaneEntries([pos("empty")], []);
  assert.equal(cells.get("empty")!.length, STAGES.length);
  assert.ok(cells.get("empty")!.every((c) => c.length === 0));
});

test("boardVisibleOrder walks lane by lane, then stage column by column, then within-cell order", () => {
  // Two lanes, entries deliberately given in a scrambled input order and across
  // stages so the global input order differs from the board's reading order.
  const positions = [pos("job-a"), pos("job-b")];
  const entries = [
    entry("b-interview", "job-b", "Interview"),
    entry("a-accepted-2", "job-a", "Accepted"),
    entry("a-interview", "job-a", "Interview"),
    entry("b-accepted", "job-b", "Accepted"),
    entry("a-accepted-1", "job-a", "Accepted"),
  ];
  // Expected: lane job-a (all its stage columns in STAGES order, within-cell input
  // order) fully before lane job-b. Accepted precedes Interview in STAGES.
  assert.deepEqual(
    boardVisibleOrder(positions, entries).map((e) => e.id),
    ["a-accepted-2", "a-accepted-1", "a-interview", "b-accepted", "b-interview"]
  );
});

test("boardVisibleOrder drops entries whose lane isn't rendered, mirroring the board", () => {
  const positions = [pos("job-a")]; // job-b filtered out of the visible board
  const order = boardVisibleOrder(positions, [entry("a1", "job-a", "Accepted"), entry("b1", "job-b", "Accepted")]);
  assert.deepEqual(order.map((e) => e.id), ["a1"]);
});

test("boardVisibleOrder walks the grid first, then the off-axis strip", () => {
  const positions = [pos("job-a")];
  const order = boardVisibleOrder(positions, [entry("legacy", "job-a", "LegacyStage"), entry("acc", "job-a", "Accepted")]);
  // The stranded candidate is still REACHABLE by the drawer's prev/next — it is
  // on screen in the off-axis strip, and a card you can see but cannot step to
  // reads as a broken control — but it sorts after everything on the board,
  // which is where the eye finds it.
  assert.deepEqual(order.map((e) => e.id), ["acc", "legacy"]);
});

test("boardVisibleOrder drops an off-axis entry whose LANE isn't rendered either", () => {
  const positions = [pos("job-a")];
  const order = boardVisibleOrder(positions, [entry("other", "job-b", "LegacyStage"), entry("acc", "job-a", "Accepted")]);
  assert.deepEqual(order.map((e) => e.id), ["acc"], "lane filtering still wins over the strip");
});
