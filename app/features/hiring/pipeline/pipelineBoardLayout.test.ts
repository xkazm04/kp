// Pure-logic coverage for the board's lane×stage bucketing. No DB, no React — the
// fold rule (each entry in exactly one cell; an unmapped stage folds into column 0;
// order preserved) is the correctness-critical half of the memoization refactor
// that replaced the per-cell `lane.filter(...)`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketLaneEntries, boardVisibleOrder } from "./pipelineBoardLayout.ts";
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

test("an unmapped/legacy stage folds into the first column, not lost", () => {
  const positions = [pos("job-a")];
  const cells = bucketLaneEntries(positions, [entry("x", "job-a", "LegacyStage")]);
  assert.deepEqual(cells.get("job-a")![0].map((e) => e.id), ["x"], "unmapped stage is visible in column 0");
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

test("boardVisibleOrder folds an unmapped stage into column 0 (still walked, not lost)", () => {
  const positions = [pos("job-a")];
  const order = boardVisibleOrder(positions, [entry("legacy", "job-a", "LegacyStage"), entry("acc", "job-a", "Accepted")]);
  // Both land in column 0 (Accepted is index 0), input order preserved.
  assert.deepEqual(order.map((e) => e.id), ["legacy", "acc"]);
});
