// What the hiring plan (board.plan, from /api/pipeline) says about ONE stage, as the board
// draws it: who executes the step and whether a human gate stops it. Pure: no fetch, no
// payload change. A null plan (before the first load) or a stage the plan is silent on is
// null, never a defaulted policy (see planStep in decision-config-schema.ts).

import { planStep, type InterviewPlanRule } from "@/app/_lib/decision-config-schema";

export type PlanExecutor = "ai" | "human" | "mixed";

export type StagePlanMark = {
  /** Who runs the rounds at this stage; null when the step runs none (screening, offer, homework). */
  executor: PlanExecutor | null;
  /** The plan stops this stage for a human. */
  humanGate: boolean;
};

export function stagePlanMark(plan: InterviewPlanRule | null | undefined, stageId: string): StagePlanMark | null {
  if (!plan) return null;
  const step = planStep(plan, stageId);
  if (!step) return null;
  const kinds = new Set(step.rounds.map((r) => r.kind));
  const executor: PlanExecutor | null = kinds.size === 0 ? null : kinds.size > 1 ? "mixed" : kinds.has("ai") ? "ai" : "human";
  return { executor, humanGate: step.gate === "human" };
}

/** The labels the ring key hands OrbitPlanMark for one stage; both null when the plan draws nothing there. */
export function planMarkText(
  plan: InterviewPlanRule | null | undefined,
  stageId: string,
  say: (key: PlanExecutor | "humanGate") => string
): { executor: string | null; gate: string | null } | null {
  const m = stagePlanMark(plan, stageId);
  if (!m || (!m.executor && !m.humanGate)) return null;
  return { executor: m.executor ? say(m.executor) : null, gate: m.humanGate ? say("humanGate") : null };
}
