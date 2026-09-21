import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STAGE_AXIS, type StageDef } from "@/app/_lib/pipeline-stages";
import type { Entry, Position } from "@/app/features/shared/pipelineTypes";
import { entryColumnCohort, lineBatchItems } from "./lineActions";

const pos: Position = { id: "job-1", title: "Backend", family: "eng", count: 3 };
const e = (id: string, stage: string, over: Partial<Entry> = {}): Entry =>
  ({ id, stage, status: "active", jobId: "job-1", jobTitle: "Backend", ...over }) as Entry;

test("the cohort is the position's active candidates on the ENTRY column only", () => {
  const entries = [
    e("a", "Accepted"),
    e("b", "Accepted", { status: "rejected" }),
    e("c", "Screened"),
    e("d", "Accepted", { jobId: "job-2" }),
  ];
  assert.deepEqual(entryColumnCohort(pos, entries, DEFAULT_STAGE_AXIS).map((x) => x.id), ["a"]);
});

test("a title-only lane keys by title", () => {
  const p: Position = { id: "Untitled role", title: "Untitled role", family: "?", count: 1 };
  const entries = [e("a", "Accepted", { jobId: null, jobTitle: "Untitled role" })];
  assert.equal(entryColumnCohort(p, entries, DEFAULT_STAGE_AXIS).length, 1);
});

test("accept all moves to the column after the entry column; reject all rejects — both guarded", () => {
  const cohort = [e("a", "Accepted")];
  assert.deepEqual(lineBatchItems(cohort, "acceptAll", DEFAULT_STAGE_AXIS), [
    { id: "a", action: "set_stage", toStage: "Screened", expectedStage: "Accepted" },
  ]);
  assert.deepEqual(lineBatchItems(cohort, "rejectAll", DEFAULT_STAGE_AXIS), [{ id: "a", action: "reject", expectedStage: "Accepted" }]);
});

test("a renamed axis resolves the entry column by role", () => {
  const axis: StageDef[] = [
    { id: "New", label: "New", role: "entry" },
    { id: "Triage", label: "Triage", role: "screening" },
    { id: "Placed", label: "Placed", role: "terminal" },
  ];
  const cohort = entryColumnCohort(pos, [e("a", "New")], axis);
  assert.equal(cohort.length, 1);
  const [item] = lineBatchItems(cohort, "acceptAll", axis);
  assert.ok(item.action === "set_stage");
  assert.equal(item.toStage, "Triage");
});
