// Who a candidate on the board is WAITING ON — a person or the AI — read from the
// workspace's hiring plan (Settings → Hiring: each step's executor and gate) and the
// entry's own approval flag. The Subway line header counts these per position, so a
// glance down the map answers "where is a human needed?" and "where is the machine
// still working?".
//
// The rule, per active candidate:
//   • a pending approval (any recognised approval kind)      → a PERSON. Whatever the
//     step, the AI has already spoken and a human has to ratify it.
//   • an interview step run by a PERSON (the plan's round)   → a PERSON.
//   • an interview step run by the AI (or with no plan yet — the untouched default
//     round is AI), a screening step, a scoring step         → the AI.
//   • the offer step with no pending approval                → neither. The board row
//     cannot tell "not drafted" from "sent, waiting on the candidate", so it claims
//     nothing rather than blaming the machine for a candidate's silence.
//   • entry, terminal and custom steps, and closed entries   → neither.
//
// Pure and React-free, so the rule is unit-tested beside the settings it reads.

import { needsHumanDecision } from "@/app/_lib/approval-kinds";
import { planStep, type InterviewPlanRule } from "@/app/_lib/decision-config-schema";
import { screeningStageIds, type StageDef } from "@/app/_lib/pipeline-stages";
import type { Entry } from "@/app/features/shared/pipelineTypes";

export type WaitingOn = "human" | "ai";

export function waitingOn(
  entry: Pick<Entry, "stage" | "status" | "approvalKind">,
  axis: readonly StageDef[],
  plan: InterviewPlanRule | null,
): WaitingOn | null {
  if (entry.status !== "active") return null;
  if (needsHumanDecision(entry.approvalKind)) return "human";
  const stage = axis.find((s) => s.id === entry.stage);
  if (!stage) return null;
  if (stage.role === "interview") {
    const round = plan ? planStep(plan, stage.id)?.rounds[0] : undefined;
    return round?.kind === "human" ? "human" : "ai";
  }
  // A homework column: the case is generated, sent and evaluated by the AI.
  if (stage.role === "scoring" || stage.role === "screening" || stage.role === "homework") return "ai";
  // The entry column is screened by the AI too (it is a pre-gate column).
  if (screeningStageIds(axis).includes(stage.id) && stage.role !== "terminal") return "ai";
  return null;
}

export type LineAttention = { human: number; ai: number };

/** The counts for one position's cells. */
export function lineAttention(
  cells: readonly (readonly Entry[])[],
  axis: readonly StageDef[],
  plan: InterviewPlanRule | null,
): LineAttention {
  const out: LineAttention = { human: 0, ai: 0 };
  for (const cell of cells) {
    for (const e of cell) {
      const who = waitingOn(e, axis, plan);
      if (who) out[who] += 1;
    }
  }
  return out;
}
