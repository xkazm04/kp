import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STAGE_AXIS, type StageDef } from "@/app/_lib/pipeline-stages";
import type { InterviewPlanRule } from "@/app/_lib/decision-config-schema";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import { lineAttention, waitingOn } from "./lineAttention";

// The Subway line header's two indicators: candidates waiting on a PERSON and
// candidates waiting on the AI, read from the hiring plan in Settings → Hiring.

const e = (stage: string, over: Partial<Entry> = {}): Entry =>
  ({ id: stage, stage, status: "active", approvalKind: null, ...over }) as Entry;

const AXIS: readonly StageDef[] = [
  { id: "New", label: "New", role: "entry" },
  { id: "Triage", label: "Triage", role: "screening" },
  { id: "AI round", label: "AI round", role: "interview" },
  { id: "Panel", label: "Panel", role: "interview" },
  { id: "Score", label: "Score", role: "scoring" },
  { id: "Offer", label: "Offer", role: "offer" },
  { id: "Hired", label: "Hired", role: "terminal" },
];
const PLAN: InterviewPlanRule = {
  steps: [
    { stageId: "Triage", gate: "human", rounds: [] },
    { stageId: "AI round", gate: "human", rounds: [{ kind: "ai", gate: "auto", topN: null }] },
    { stageId: "Panel", gate: "human", rounds: [{ kind: "human", gate: "human", topN: 5 }] },
  ],
};

test("a pending approval is a person's, on any step", () => {
  assert.equal(waitingOn(e("Triage", { approvalKind: "screening_review" }), AXIS, PLAN), "human");
  assert.equal(waitingOn(e("Offer", { approvalKind: "offer_review" }), AXIS, PLAN), "human");
});

test("an unrecognised approval kind is not a human gate (a typo must not masquerade as one)", () => {
  assert.equal(waitingOn(e("Triage", { approvalKind: "screen" }), AXIS, PLAN), "ai");
});

test("an interview step follows the plan's executor: a person's round or the AI's", () => {
  assert.equal(waitingOn(e("Panel"), AXIS, PLAN), "human");
  assert.equal(waitingOn(e("AI round"), AXIS, PLAN), "ai");
});

test("with no plan (not loaded, or never saved) an interview step is the default AI round", () => {
  assert.equal(waitingOn(e("Panel"), AXIS, null), "ai");
});

test("entry and screening columns are screened by the AI; scoring is the AI's", () => {
  assert.equal(waitingOn(e("New"), AXIS, PLAN), "ai");
  assert.equal(waitingOn(e("Triage"), AXIS, PLAN), "ai");
  assert.equal(waitingOn(e("Score"), AXIS, PLAN), "ai");
});

test("nothing is claimed for an unflagged offer, the outcome, a closed entry or an off-axis stage", () => {
  assert.equal(waitingOn(e("Offer"), AXIS, PLAN), null);
  assert.equal(waitingOn(e("Hired"), AXIS, PLAN), null);
  assert.equal(waitingOn(e("Panel", { status: "rejected" }), AXIS, PLAN), null);
  assert.equal(waitingOn(e("Retired"), AXIS, PLAN), null);
});

test("the shipped board: Accepted and Screened wait on the AI, Hired on nobody", () => {
  assert.equal(waitingOn(e("Accepted"), DEFAULT_STAGE_AXIS, null), "ai");
  assert.equal(waitingOn(e("Screened"), DEFAULT_STAGE_AXIS, null), "ai");
  assert.equal(waitingOn(e("Hired"), DEFAULT_STAGE_AXIS, null), null);
});

test("a line counts both kinds across its cells", () => {
  const cells = [[e("Triage"), e("Triage", { approvalKind: "screening_review" })], [e("Panel")], [e("Offer")]];
  assert.deepEqual(lineAttention(cells, AXIS, PLAN), { human: 2, ai: 1 });
});
