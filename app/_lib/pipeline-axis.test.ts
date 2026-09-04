// The PURE half of the board-axis resolver — the module twenty-four call sites
// ask "which columns does this team's board have", and which had no direct test
// at all (one indirect hit through a store suite).
//
// No project import touches the DB here on purpose: pipeline-axis.ts is the half
// that also runs in the BROWSER (the board resolves retired labels and detects
// off-axis entries client-side), so it must stay exercisable without SQLite.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultResolvedAxis,
  findStage,
  knownStageIds,
  offAxisStageIds,
  resolveStageAxis,
} from "./pipeline-axis.ts";
import { DEFAULT_STAGE_AXIS } from "./pipeline-stages.ts";
import type { PipelineStagesRule } from "./decision-config-schema.ts";

const RENAMED: PipelineStagesRule = {
  stages: [
    { id: "Accepted", label: "New applicants", role: "entry" },
    { id: "Screened", label: "Reviewed", role: "screening" },
    { id: "Signed", label: "Signed", role: "terminal" },
  ],
  retired: [{ id: "Interview", label: "Interview", role: "interview" }],
};

test("no override resolves to the shipped axis, and the copy is not the shared literal", () => {
  const axis = defaultResolvedAxis();
  assert.deepEqual(
    axis.stages.map((s) => s.id),
    DEFAULT_STAGE_AXIS.map((s) => s.id)
  );
  assert.deepEqual(axis.retired, []);
  // Callers mutate what they are handed (the composer edits labels in place); a
  // shared reference would rewrite the module constant for the whole process.
  assert.notEqual(axis.stages[0], DEFAULT_STAGE_AXIS[0]);
  axis.stages[0]!.label = "Touched";
  assert.equal(DEFAULT_STAGE_AXIS[0]!.label, "Accepted");
});

test("null, undefined and an EMPTY stage list all fall back rather than render a blank board", () => {
  // The validator forbids an empty axis, so this is the last thing standing
  // between a corrupt row and a board with no columns — which loses every
  // candidate from view rather than showing them somewhere wrong.
  for (const rule of [null, undefined, { stages: [], retired: [] }, { stages: "nope" } as unknown as PipelineStagesRule]) {
    const axis = resolveStageAxis(rule as PipelineStagesRule | null | undefined);
    assert.deepEqual(
      axis.stages.map((s) => s.id),
      DEFAULT_STAGE_AXIS.map((s) => s.id),
      `${JSON.stringify(rule)} falls back to the shipped axis`
    );
  }
});

test("a stored override resolves to its own columns, roles intact, retired kept separate", () => {
  const axis = resolveStageAxis(RENAMED);
  assert.deepEqual(axis.stages.map((s) => s.id), ["Accepted", "Screened", "Signed"]);
  assert.deepEqual(axis.stages.map((s) => s.label), ["New applicants", "Reviewed", "Signed"]);
  assert.equal(axis.stages[2]!.role, "terminal", "the renamed terminal column keeps its ROLE");
  assert.deepEqual(axis.retired.map((s) => s.id), ["Interview"]);
  // A config that stores no `retired` key at all is not a crash.
  assert.deepEqual(resolveStageAxis({ stages: RENAMED.stages } as PipelineStagesRule).retired, []);
});

test("knownStageIds spans live AND retired — a retired column is a legal place to be standing", () => {
  const known = knownStageIds(resolveStageAxis(RENAMED));
  assert.deepEqual([...known].sort(), ["Accepted", "Interview", "Screened", "Signed"]);
  assert.ok(known.has("Interview"), "a candidate stranded on a dropped column is still resolvable");
  assert.ok(!known.has("Hired"), "the shipped terminal id is NOT known to a board that renamed it");
});

test("findStage resolves live and retired, and answers null for a stranger", () => {
  const axis = resolveStageAxis(RENAMED);
  assert.equal(findStage(axis, "Signed")?.label, "Signed");
  assert.equal(findStage(axis, "Interview")?.label, "Interview", "history renders a dropped column's LABEL, not a raw id");
  assert.equal(findStage(axis, "Hired"), null);
});

test("offAxisStageIds names only genuine strangers, deduped and sorted", () => {
  const axis = resolveStageAxis(RENAMED);
  assert.deepEqual(
    offAxisStageIds(axis, ["Accepted", "Interview", "Hired", "Offer", "Hired", "Screened"]),
    ["Hired", "Offer"],
    "retired ids are NOT off-axis; unknown ids are, once each, sorted"
  );
  assert.deepEqual(offAxisStageIds(axis, []), []);
  assert.deepEqual(
    offAxisStageIds(defaultResolvedAxis(), ["Accepted", "Screened", "Interview", "Offer", "Hired"]),
    [],
    "nothing on the shipped axis is off it"
  );
});
