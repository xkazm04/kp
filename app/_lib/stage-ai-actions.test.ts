import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STAGE_AXIS, type StageDef } from "./pipeline-stages.ts";
import { defaultStageActions, isDefaultStageActions, offeredStageActions, stageActions } from "./stage-ai-actions.ts";
import { validateDecisionConfig, PIPELINE_STAGES_DEFAULT } from "./decision-config-schema.ts";

// Which AI actions a column offers. Two layers, both pinned here: the product default
// resolved by ROLE (board-actions-survive-a-renamed-axis — literal stage names once
// matched nothing on a renamed board), and the workspace's own per-step list from
// Settings → Hiring, which replaces the default and is what the server enforces.

const ids = (stage: string, axis?: readonly StageDef[], status = "active") => offeredStageActions({ stage, status }, axis);

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
  assert.deepEqual(ids("Hired"), ["outreach"]);
});

test("a renamed axis keeps every action — resolved by role, not by name", () => {
  assert.deepEqual(ids("New applicants", RENAMED), ["screen", "outreach", "rejection"]);
  assert.deepEqual(ids("Triaged", RENAMED), ["screen", "prep", "outreach", "rejection", "rematch"]);
  assert.deepEqual(ids("Loop", RENAMED), ["prep", "scorecard", "outreach", "rejection", "rematch"]);
  assert.deepEqual(ids("Package", RENAMED), ["offer", "outreach", "rejection", "rematch"]);
  assert.deepEqual(ids("Placed", RENAMED), ["outreach"]);
});

test("a homework column offers outreach, rejection and rematch — never `screen`", () => {
  // The enterprise funnel: the case sits BEFORE the AI interview, so it is pre-gate
  // — but nothing triages a CV there, and a "Screen with AI" run at a case column
  // would advance the candidate past the very assignment the column exists to give
  // them. `prep` is out for the same reason: there is nothing to prep from until
  // the case comes back.
  const funnel: readonly StageDef[] = [
    { id: "In", label: "In", role: "entry" },
    { id: "Case", label: "Homework", role: "homework" },
    { id: "AI", label: "AI interview", role: "interview" },
    { id: "Triage", label: "Screened", role: "screening" },
    { id: "Panel", label: "Human interview", role: "interview" },
    { id: "Package", label: "Offer", role: "offer" },
    { id: "Placed", label: "Hired", role: "terminal" },
  ];
  assert.deepEqual(ids("Case", funnel), ["outreach", "rejection", "rematch"]);
  // The columns around it are unchanged: the entry column still screens, and the
  // post-gate screening column keeps its own triage run.
  assert.deepEqual(ids("In", funnel), ["screen", "outreach", "rejection"]);
  assert.deepEqual(ids("Triage", funnel), ["screen", "prep", "outreach", "rejection", "rematch"]);
  assert.deepEqual(ids("AI", funnel), ["prep", "scorecard", "outreach", "rejection", "rematch"]);
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

// --- the workspace's own list -----------------------------------------------------

const withActions = (stageId: string, actions: StageDef["actions"]): StageDef[] =>
  RENAMED.map((s) => (s.id === stageId ? { ...s, actions } : s));

test("a column's own list REPLACES the default, in canonical order", () => {
  const axis = withActions("Loop", ["rejection", "scorecard"]);
  assert.deepEqual(stageActions("Loop", axis), ["scorecard", "rejection"]);
  // Neighbours keep their defaults.
  assert.deepEqual(stageActions("Triaged", axis), defaultStageActions("Triaged", RENAMED));
});

test("an empty list is a real answer: nothing runs at that step", () => {
  assert.deepEqual(ids("Package", withActions("Package", [])), []);
});

test("a custom list can offer an action the role would not (outreach-only terminal → offer)", () => {
  assert.deepEqual(ids("Placed", withActions("Placed", ["outreach", "offer"])), ["offer", "outreach"]);
});

test("a closed candidate still keeps only rematch, and only if the column offers it", () => {
  assert.deepEqual(ids("Loop", withActions("Loop", ["scorecard"]), "rejected"), []);
});

test("isDefaultStageActions is order-insensitive and exact", () => {
  assert.equal(isDefaultStageActions("Hired", ["outreach"]), true);
  assert.equal(isDefaultStageActions("Offer", ["rematch", "offer", "outreach", "rejection"]), true);
  assert.equal(isDefaultStageActions("Offer", ["offer"]), false);
});

// --- the stored shape -------------------------------------------------------------

const stagesWith = (patch: Record<string, unknown>) => ({
  ...PIPELINE_STAGES_DEFAULT,
  stages: PIPELINE_STAGES_DEFAULT.stages.map((s) => (s.id === "Interview" ? { ...s, ...patch } : s)),
});

test("the validator stores a list normalised to canonical order, and nothing when absent", () => {
  const ok = validateDecisionConfig("pipelineStages", stagesWith({ actions: ["rejection", "prep"] }));
  assert.ok(ok.ok && ok.phase === "pipelineStages");
  if (!ok.ok || ok.phase !== "pipelineStages") return;
  assert.deepEqual(ok.config.stages.find((s) => s.id === "Interview")?.actions, ["prep", "rejection"]);
  assert.equal("actions" in (ok.config.stages.find((s) => s.id === "Offer") ?? {}), false);
});

test("the validator refuses unknown or repeated actions", () => {
  assert.equal(validateDecisionConfig("pipelineStages", stagesWith({ actions: ["hire"] })).ok, false);
  assert.equal(validateDecisionConfig("pipelineStages", stagesWith({ actions: ["prep", "prep"] })).ok, false);
  assert.equal(validateDecisionConfig("pipelineStages", stagesWith({ actions: "prep" })).ok, false);
});
