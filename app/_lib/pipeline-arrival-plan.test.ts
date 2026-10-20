// blast-radius-computation — the arrival planner a bulk move PREVIEWS with is the one
// the stage-entered hook EXECUTES with (challenge-r06 pipeline-move-bulk-operations/B).
//
// The pure cases pin what each arrival sets off; the unit-DB case pins PARITY: the
// planner's `refused_terminal` is exactly the set_stage door's 422, and the hook takes
// the branch the planner named, because it reads the same decision.
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH before any store
// module resolves db-path.ts).
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createPipelineEntry } from "./db/pipeline.ts";
import { setDecisionConfig, getDecisionConfigVersion } from "./decision-config-store.ts";
import { getInterviewPlan } from "./interview-plan.ts";
import { getPipelineAxis } from "./pipeline-axis-server.ts";
import { runPipelineEntryAction } from "./pipeline-entry-action.ts";
import { runStageEnteredHook } from "./stage-hooks.ts";
import { DEFAULT_STAGE_AXIS, type StageDef } from "./pipeline-stages.ts";
import type { InterviewPlanRule } from "./decision-config-schema.ts";
import { planArrival, arrivalBranch } from "./pipeline-arrival-plan.ts";

after(() => cleanupUnitDb());
before(() => {
  process.env.OPENAI_API_KEY = "test-key-not-used-for-any-call";
});

const aiPlan = (gate: "auto" | "human", stageId = "Interview"): InterviewPlanRule => ({
  steps: [{ stageId, gate, rounds: [{ kind: "ai", gate, topN: null }] }],
});
const screened = { stage: "Screened", status: "active", approvalKind: null };

test("an AI interview column: auto invites now, a saved human gate holds, a never-saved plan invites", () => {
  assert.equal(planArrival(screened, "Interview", DEFAULT_STAGE_AXIS, aiPlan("auto"), true).effect, "ai_invite");
  assert.equal(planArrival(screened, "Interview", DEFAULT_STAGE_AXIS, aiPlan("human"), true).effect, "ai_invite_held");
  // effectiveInterviewGate's rule: only a SAVED plan's gate is honoured.
  assert.equal(planArrival(screened, "Interview", DEFAULT_STAGE_AXIS, aiPlan("human"), false).effect, "ai_invite");
});

const COMPOSED: readonly StageDef[] = [
  { id: "Applied", label: "Applied", role: "entry" },
  { id: "Case", label: "Case", role: "homework" },
  { id: "Chat", label: "Chat", role: "interview" },
  { id: "Offer", label: "Offer", role: "offer" },
  { id: "Done", label: "Done", role: "terminal" },
];
const humanRound: InterviewPlanRule = {
  steps: [{ stageId: "Chat", gate: "human", rounds: [{ kind: "human", gate: "human", topN: null }] }],
};
const applied = { stage: "Applied", status: "active", approvalKind: null };

test("a homework column sends an assignment; a custom column or a human first round is plain", () => {
  assert.equal(planArrival(applied, "Case", COMPOSED, humanRound, true).effect, "homework");
  const withCustom: StageDef[] = [...COMPOSED.slice(0, 3), { id: "Hold", label: "Hold", role: "custom" }, ...COMPOSED.slice(3)];
  assert.equal(planArrival(applied, "Hold", withCustom, humanRound, true).effect, "plain");
  assert.equal(planArrival(applied, "Chat", COMPOSED, humanRound, true).effect, "plain");
});

test("a pending approval is cleared by the move; a drafted offer holds the row back", () => {
  const offer = planArrival({ stage: "Offer", status: "active", approvalKind: "offer_review" }, "Chat", COMPOSED, humanRound, true);
  assert.equal(offer.clears, "offer_review");
  assert.equal(offer.holdBack, true);
  const scorecard = planArrival({ stage: "Chat", status: "active", approvalKind: "scorecard_review" }, "Offer", COMPOSED, humanRound, true);
  assert.equal(scorecard.clears, "scorecard_review");
  assert.equal(scorecard.holdBack, false, "disclosed, not blocked");
});

test("a terminal column is refused, the current column is a no-op, a closed entry does not move", () => {
  assert.equal(planArrival(applied, "Done", COMPOSED, humanRound, true).effect, "refused_terminal");
  assert.equal(planArrival(applied, "Applied", COMPOSED, humanRound, true).effect, "noop");
  assert.equal(planArrival({ stage: "Applied", status: "rejected", approvalKind: null }, "Chat", COMPOSED, humanRound, true).effect, "closed");
  // Nothing is cleared by a move that does not happen.
  assert.equal(planArrival({ stage: "Applied", status: "active", approvalKind: "offer_review" }, "Applied", COMPOSED, humanRound, true).clears, null);
});

test("parity: planArrival's refusal IS set_stage's 422, and the hook takes the branch the planner named", async () => {
  const WS_HELD = "arrival-parity-held";
  const WS_HUMAN = "arrival-parity-human";
  setDecisionConfig("pipelineStages", { stages: COMPOSED, retired: [] }, WS_HELD);
  setDecisionConfig("pipelineStages", { stages: COMPOSED, retired: [] }, WS_HUMAN);
  setDecisionConfig("interviewPlan", aiPlan("human", "Chat"), WS_HELD);
  setDecisionConfig("interviewPlan", humanRound, WS_HUMAN);

  let seq = 0;
  const entryAt = (ws: string, stage: string, contact: string | null) => {
    seq += 1;
    return createPipelineEntry({
      candidateId: `arr-c${seq}`,
      candidateLabel: `Arrival Candidate ${seq}`,
      jobId: `arr-job-${seq}`,
      jobTitle: "Arrival Role",
      contact,
      stage,
      archetype: "student",
      workspaceId: ws,
    }).entry;
  };

  // The hook's branch for each planner branch.
  const HOOK_BRANCH: Record<string, (o: { outcome: string; reason?: string }) => boolean> = {
    homework: (o) => o.outcome === "skipped" && (o.reason === "no_jd" || o.reason === "no_job"),
    not_interview_role: (o) => o.outcome === "skipped" && o.reason === "not_interview_role",
    no_ai_round: (o) => o.outcome === "skipped" && o.reason === "no_ai_round",
    ai_invite_held: (o) => o.outcome === "held",
    refused_terminal: (o) => o.outcome === "skipped" && o.reason === "not_interview_role",
  };

  let checked = 0;
  for (const ws of [WS_HELD, WS_HUMAN]) {
    const axis = getPipelineAxis(ws).stages;
    const plan = getInterviewPlan(ws);
    const saved = getDecisionConfigVersion("interviewPlan", ws) !== null;
    for (const target of ["Case", "Chat", "Offer", "Done"]) {
      // The door: a real set_stage from Applied.
      const mover = entryAt(ws, "Applied", null);
      const planned = planArrival(mover, target, axis, plan, saved);
      const res = await runPipelineEntryAction({ id: mover.id, action: "set_stage", toStage: target, expectedStage: "Applied", origin: "http://localhost", workspaceId: ws });
      const refused = res.status === 422 && (res.body as { code?: string }).code === "PIPELINE_TERMINAL_NOT_MANUAL";
      assert.equal(planned.effect === "refused_terminal", refused, `${ws} -> ${target}: planner and door agree on the terminal refusal`);
      if (!refused) assert.equal(res.status, 200, `${ws} -> ${target}: the door moved it`);

      // The hook: an entry standing on the target, run directly.
      const branch = arrivalBranch(target, axis, plan, saved);
      const standing = entryAt(ws, target, "arrival@example.com");
      const outcome = (await runStageEnteredHook({ entryId: standing.id, stage: target, workspaceId: ws })) as { outcome: string; reason?: string };
      const expect = HOOK_BRANCH[branch];
      assert.ok(expect, `no hook mapping for branch ${branch}`);
      assert.ok(expect(outcome), `${ws} -> ${target}: planner said ${branch}, hook answered ${JSON.stringify(outcome)}`);
      checked += 1;
    }
  }
  assert.equal(checked, 8);
});
