import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readStageParam, resolveStageFilter } from "./usePipelineFilters.ts";
import { DEFAULT_STAGE_AXIS, PIPELINE_STAGES, type StageDef } from "@/app/_lib/pipeline-stages";

// UAT TOM-ANA-11 — the board's ?stage= deep link, pinned against the WORKSPACE axis.
//
// The defect this file exists to stop coming back: the guard that accepted the param
// read the hardcoded five-stage PIPELINE_STAGES while the funnel that MINTS the link
// reads getPipelineAxis(workspaceId).stages — the workspace's own, editable via
// Settings → Hiring. Every id from a customized axis failed the guard, the filter
// silently became null, and the board rendered the unfiltered set: a drill-down that
// answers a different question than the one asked, with nothing on screen saying so.
//
// Nothing here may be re-expressed in terms of PIPELINE_STAGES: that list being the
// wrong authority IS the finding.

// A workspace that renamed a shipped column and added one of its own — the shape the
// old guard could not survive.
const CUSTOM_AXIS: readonly StageDef[] = [
  { id: "Accepted", label: "New applicants", role: "entry" },
  { id: "Screened", label: "Screened", role: "screening" },
  { id: "Interview", label: "First round", role: "interview" },
  { id: "Interview 2", label: "Second round", role: "custom" },
  { id: "Offer", label: "Offer", role: "offer" },
  { id: "Hired", label: "Hired", role: "terminal" },
];

test("readStageParam keeps the deep link's value verbatim, whatever the axis calls it", () => {
  assert.equal(readStageParam("Interview"), "Interview");
  // The regression itself: an id no hardcoded list knows must survive the read.
  assert.equal(readStageParam("Interview 2"), "Interview 2");
  assert.ok(!PIPELINE_STAGES.includes("Interview 2" as never), "fixture guard: this id is off the shipped list");
});

test("an absent, blank or whitespace-only ?stage= is no filter at all", () => {
  assert.equal(readStageParam(null), null);
  assert.equal(readStageParam(""), null);
  assert.equal(readStageParam("   "), null);
  // Trimmed rather than rejected: a stray space in a pasted URL is not a different stage.
  assert.equal(readStageParam(" Offer "), "Offer");
});

test("a stage the WORKSPACE added is on the board, and reads as the workspace named it", () => {
  const r = resolveStageFilter("Interview 2", CUSTOM_AXIS);
  assert.equal(r.onBoard, true, "a custom column is a column");
  assert.equal(r.label, "Second round");
});

test("a renamed shipped column keeps its id and shows the new name", () => {
  const r = resolveStageFilter("Accepted", CUSTOM_AXIS);
  assert.equal(r.onBoard, true);
  assert.equal(r.label, "New applicants");
});

test("on the shipped axis the label is null — the enums catalog owns the translation", () => {
  // DEFAULT_STAGE_AXIS stores label === id, so echoing it back would push an untranslated
  // English id onto a Czech board. Null hands the naming to enumLabel("stage", …).
  for (const s of DEFAULT_STAGE_AXIS) {
    const r = resolveStageFilter(s.id, DEFAULT_STAGE_AXIS);
    assert.equal(r.onBoard, true, `${s.id} is a shipped column`);
    assert.equal(r.label, null, `${s.id} must not hardcode its own English label`);
  }
});

test("a stage the workspace DROPPED is off the board and is still named, from the tombstone", () => {
  const retired: StageDef[] = [{ id: "Phone screen", label: "Phone screen", role: "screening" }];
  const named: StageDef[] = [{ id: "Interview 2", label: "Second round", role: "custom" }];
  // label === id ⇒ no workspace-authored name to show, but the verdict still stands.
  assert.deepEqual(resolveStageFilter("Phone screen", DEFAULT_STAGE_AXIS, retired), { label: null, onBoard: false });
  assert.deepEqual(resolveStageFilter("Interview 2", DEFAULT_STAGE_AXIS, named), { label: "Second round", onBoard: false });
});

test("a stage on NEITHER list is off the board with no name to offer", () => {
  // The stale-link case: nothing can name it, so the caller falls back to the raw id
  // rather than inventing a label. What matters is that onBoard is false, which is what
  // the filter bar turns into an explicit notice instead of a silently unfiltered board.
  assert.deepEqual(resolveStageFilter("Sourced", DEFAULT_STAGE_AXIS), { label: null, onBoard: false });
});

test("resolution never consults the hardcoded axis — the workspace's own list is the authority", () => {
  // A workspace that dropped a SHIPPED column: "Offer" is on PIPELINE_STAGES and must
  // still read as off THIS board. The old guard got this exactly backwards.
  const withoutOffer = CUSTOM_AXIS.filter((s) => s.id !== "Offer");
  assert.ok(PIPELINE_STAGES.includes("Offer" as never), "fixture guard: Offer is a shipped stage");
  assert.equal(resolveStageFilter("Offer", withoutOffer).onBoard, false);
});

// ---- The same authority question, one level up: the board's STAT CHIPS ------------
//
// usePipelineTabState derived three recruiter-facing numbers from stage NAMES —
// `e.stage !== "Hired"` (Active), `e.stage === "Interview"` (In interview) and the
// same `!== "Hired"` inside `isStale` (the amber aging dot + its chip). On a
// workspace axis with a second interview column those miss every candidate standing
// in it, and on an axis whose terminal column is not literally called "Hired" they
// count hired candidates as active AND age them (slaForStage falls back to
// STALE_DAYS for a stage it doesn't know). A hook has no runner here, so this is a
// SOURCE guard — the same shape as result-view-unpriced.test.ts — pinning that the
// counts ask pipeline-stages.ts for the role instead.
const TAB_STATE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "usePipelineTabState.ts"),
  "utf8"
);

test("the board's stat counts read stage ROLES, never stage names", () => {
  for (const literal of ['stage !== "Hired"', 'stage === "Interview"', 'stage === "Hired"']) {
    assert.equal(
      TAB_STATE.includes(literal),
      false,
      `usePipelineTabState must not derive a count from the literal \`${literal}\` — the axis is workspace-editable`
    );
  }
  assert.match(TAB_STATE, /stageHasRole\([^)]*"terminal"[^)]*board\.axis\)/, "the terminal test must resolve against the board's own axis");
  assert.match(TAB_STATE, /stagesWithRole\("interview", board\.axis\)/, "the interview count must cover EVERY interview column");
});
