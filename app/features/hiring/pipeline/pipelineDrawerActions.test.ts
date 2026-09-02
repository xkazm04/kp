import test from "node:test";
import assert from "node:assert/strict";
import { pipelineDrawerActionIds } from "./pipelineDrawerActions.ts";
import { DEFAULT_STAGE_AXIS, type StageDef } from "@/app/_lib/pipeline-stages.ts";


// board-actions-survive-a-renamed-axis — the drawer's AI-actions grid used to gate
// each action on LITERAL stage names ("Screened", "Interview", "Offer") while every
// other board consumer resolves the same questions through stage ROLES. A workspace
// that renamed its columns therefore matched nothing and silently lost six of the
// seven actions. These pin the role resolution on BOTH the shipped axis (where the
// answer must be byte-identical to the old literals) and a fully renamed one.

const ids = (stage: string, axis?: readonly StageDef[], status = "active") =>
  pipelineDrawerActionIds({ stage, status }, axis);

// The workspace board this repo ships, renamed end to end — ids differ from the
// canonical names, roles are unchanged. This is exactly what Settings → Hiring
// composes, and the axis GET /api/pipeline hands the board.
const RENAMED: readonly StageDef[] = [
  { id: "New applicants", label: "New applicants", role: "entry" },
  { id: "Triaged", label: "Triaged", role: "screening" },
  { id: "Loop", label: "Loop", role: "interview" },
  { id: "Package", label: "Package", role: "offer" },
  { id: "Placed", label: "Placed", role: "terminal" },
];

test("shipped axis: each stage offers the same actions the literal gates did", () => {
  assert.deepEqual(ids("Accepted"), ["screen", "outreach", "rejection"]);
  assert.deepEqual(ids("Screened"), ["screen", "prep", "outreach", "rejection", "rematch"]);
  assert.deepEqual(ids("Interview"), ["prep", "scorecard", "outreach", "rejection", "rematch"]);
  assert.deepEqual(ids("Offer"), ["offer", "outreach", "rejection", "rematch"]);
  // The terminal column is outcome-bearing: nothing to screen, reject or rematch.
  assert.deepEqual(ids("Hired"), ["outreach"]);
});

test("a renamed axis keeps every action — resolved by role, not by name", () => {
  assert.deepEqual(ids("New applicants", RENAMED), ["screen", "outreach", "rejection"]);
  assert.deepEqual(ids("Triaged", RENAMED), ["screen", "prep", "outreach", "rejection", "rematch"]);
  assert.deepEqual(ids("Loop", RENAMED), ["prep", "scorecard", "outreach", "rejection", "rematch"]);
  assert.deepEqual(ids("Package", RENAMED), ["offer", "outreach", "rejection", "rematch"]);
  assert.deepEqual(ids("Placed", RENAMED), ["outreach"]);
});

test("a stage off the axis resolves no role, so only the unconditional actions show", () => {
  assert.deepEqual(ids("Retired column", RENAMED), ["outreach"]);
});

test("a non-active entry keeps only rematch", () => {
  assert.deepEqual(ids("Loop", RENAMED, "rejected"), ["rematch"]);
});

test("the default axis parameter is the shipped board", () => {
  assert.deepEqual(ids("Interview"), ids("Interview", DEFAULT_STAGE_AXIS));
});
