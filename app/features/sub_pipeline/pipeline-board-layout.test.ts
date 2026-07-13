// Pure-logic coverage for the board's lane×stage bucketing. No DB, no React — the
// fold rule (each entry in exactly one cell; an unmapped stage folds into column 0;
// order preserved) is the correctness-critical half of the memoization refactor
// that replaced the per-cell `lane.filter(...)`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketLaneEntries } from "./pipeline-board-layout.ts";
import { STAGES, type Entry, type Position } from "./PipelineTypes.ts";

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
