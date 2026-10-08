import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STAGE_AXIS } from "../../../../_lib/pipeline-stages.ts";
import { strandedTargetStages } from "./strandedTargets.ts";

test("the stranded picker never offers the terminal column", () => {
  const ids = strandedTargetStages(DEFAULT_STAGE_AXIS).map((s) => s.id);
  assert.deepEqual(ids, ["Accepted", "Screened", "Interview", "Offer"]);
});

test("a renamed terminal column is dropped by role", () => {
  const axis = DEFAULT_STAGE_AXIS.map((s) => (s.role === "terminal" ? { ...s, id: "Started", label: "Started" } : s));
  const ids = strandedTargetStages(axis).map((s) => s.id);
  assert.ok(!ids.includes("Started"));
  assert.equal(ids.length, axis.length - 1);
});
