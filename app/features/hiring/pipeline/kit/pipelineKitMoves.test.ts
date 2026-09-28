// The pipeline's move rules (pipelineKitMoves.ts), recovered from the retired board's
// subwayInteraction.test.ts (deleted at b7fde0c32): column names, Move-to targets, stranded columns.
//
// Runner: Node's built-in test runner with type stripping - npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STAGE_AXIS, type StageDef } from "@/app/_lib/pipeline-stages";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import { moveOptions, stageName, strandedByStage } from "./pipelineKitMoves.ts";

const e = (id: string, stage: string, over: Partial<Entry> = {}): Entry =>
  ({ id, stage, status: "active", jobId: "job-1", jobTitle: "Backend", candidateLabel: id, ...over }) as Entry;
const enumLabel = (id: string) => `enum:${id}`;

test("Move to lists the manual targets in axis order: never the own stage, never the terminal role", () => {
  const opts = moveOptions("Screened", DEFAULT_STAGE_AXIS, enumLabel).map((o) => o.value);
  assert.ok(!opts.includes("Screened"));
  assert.ok(!opts.includes("Hired"));
  assert.deepEqual(opts, ["Accepted", "Interview", "Offer"]);
});

test("a renamed terminal column refuses exactly like Hired; a workspace label wins over the enum", () => {
  const axis: StageDef[] = [
    { id: "New", label: "New", role: "entry" },
    { id: "tech", label: "Tech round", role: "interview" },
    { id: "Placed", label: "Placed", role: "terminal" },
  ];
  assert.deepEqual(moveOptions("New", axis, enumLabel), [{ value: "tech", label: "Tech round" }]);
  assert.equal(stageName("New", axis, enumLabel), "enum:New");
});

test("move all: an empty current stage lists every manual target", () => {
  assert.deepEqual(moveOptions("", DEFAULT_STAGE_AXIS, enumLabel).map((o) => o.value), ["Accepted", "Screened", "Interview", "Offer"]);
});

test("stranded candidates group by the retired stage they stand on", () => {
  const g = strandedByStage([e("a", "Second interview"), e("b", "Screened"), e("c", "Second interview"), e("d", "Old")], DEFAULT_STAGE_AXIS);
  assert.deepEqual([...g.keys()], ["Second interview", "Old"]);
  assert.deepEqual(g.get("Second interview")?.map((x) => x.id), ["a", "c"]);
});
