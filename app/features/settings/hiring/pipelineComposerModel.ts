// Pure model for the hiring-pipeline composer (Settings → Hiring): the plan a
// workspace composes (interview rounds + approval gates), the org-complexity
// presets, and the derived impact on the Hiring tabs (Overview / Decisions /
// Schedule). No JSX/hooks so it's unit-testable under node:test; the concept
// this implements is docs/concepts/interview-rounds.md (interviewPlan).
//
// PERSISTENCE: the plan is stored per workspace as the "interviewPlan" phase of
// the tiered decision-config store (decision-config-schema.ts owns the wire
// shape + validation). The stored shape carries no round ids — those are UI
// list keys minted here on load (fromStoredPlan / toStoredPlan below).
import type { InterviewPlanRule } from "@/app/_lib/decision-config-schema";

export type GateMode = "auto" | "human";
export type RoundKind = "ai" | "human";

export type PlanRound = {
  id: string;
  kind: RoundKind;
  /** Who ratifies this round's verdict: "human" routes it through Decisions
   *  (scorecard review); "auto" applies the AI verdict unattended. A HUMAN
   *  round's verdict is always human by definition — gate applies to AI rounds. */
  gate: GateMode;
  /** Cohort reducer INTO this round: only the top N of the previous round's
   *  advancers proceed. Null = everyone who advanced. Meaningless on round 1. */
  topN: number | null;
};

export type PipelinePlan = {
  /** AI screening verdicts: reviewed in Decisions ("human") or auto-applied. */
  screeningGate: GateMode;
  rounds: PlanRound[];
  /** Offer drafts: approved by a human in Decisions or auto-sent. */
  offerGate: GateMode;
};

export const MAX_ROUNDS = 3;

let seq = 0;
export const newRound = (kind: RoundKind, gate: GateMode = "human", topN: number | null = null): PlanRound => ({
  // Stable-enough ids for list keys within a session; the plan is client state
  // during prototyping (no persistence yet).
  id: `r${++seq}`,
  kind,
  gate,
  topN,
});

export type PresetId = "lean" | "hybrid" | "enterprise";
export type Preset = { id: PresetId; plan: () => PipelinePlan };

/** Org-complexity presets: solo founder → team → governance-heavy enterprise. */
export const PRESETS: Preset[] = [
  { id: "lean", plan: () => ({ screeningGate: "auto", rounds: [newRound("ai", "human")], offerGate: "human" }) },
  {
    id: "hybrid",
    plan: () => ({
      screeningGate: "human",
      rounds: [newRound("ai", "human"), newRound("human", "human", 3)],
      offerGate: "human",
    }),
  },
  {
    id: "enterprise",
    plan: () => ({
      screeningGate: "human",
      rounds: [newRound("ai", "human"), newRound("human", "human", 5), newRound("human", "human", 2)],
      offerGate: "human",
    }),
  },
];

// ---- Derived impact --------------------------------------------------------

/** What each Hiring tab would show under this plan — structured facts, the
 *  components own the copy. */
export type PlanImpact = {
  /** Funnel stations the Overview board renders, in order. */
  overview: ("screened" | "ai_interview" | "human_interview" | "offer" | "hired")[];
  /** Human queues appearing in Decisions, in pipeline order. */
  decisions: ("screening_review" | "ai_scorecard_review" | "human_scorecard_review" | "offer_review")[];
  /** Which Schedule surfaces are in play. */
  schedule: { aiRound: boolean; humanRound: boolean };
  /** Human decision points per candidate who goes the distance. */
  humanTouchpoints: number;
};

export function deriveImpact(plan: PipelinePlan): PlanImpact {
  const overview: PlanImpact["overview"] = ["screened"];
  const decisions: PlanImpact["decisions"] = [];
  if (plan.screeningGate === "human") decisions.push("screening_review");
  for (const r of plan.rounds) {
    overview.push(r.kind === "ai" ? "ai_interview" : "human_interview");
    if (r.kind === "human") decisions.push("human_scorecard_review");
    else if (r.gate === "human") decisions.push("ai_scorecard_review");
  }
  overview.push("offer", "hired");
  if (plan.offerGate === "human") decisions.push("offer_review");
  return {
    overview,
    decisions,
    schedule: {
      aiRound: plan.rounds.some((r) => r.kind === "ai"),
      humanRound: plan.rounds.some((r) => r.kind === "human"),
    },
    humanTouchpoints: decisions.length,
  };
}

/** Persisted wire shape → UI plan (mints round ids for list keys). */
export function fromStoredPlan(rule: InterviewPlanRule): PipelinePlan {
  return {
    screeningGate: rule.screeningGate,
    rounds: rule.rounds.map((r) => newRound(r.kind, r.gate, r.topN)),
    offerGate: rule.offerGate,
  };
}

/** UI plan → persisted wire shape (drops the UI-only round ids). */
export function toStoredPlan(plan: PipelinePlan): InterviewPlanRule {
  return {
    screeningGate: plan.screeningGate,
    rounds: plan.rounds.map((r) => ({ kind: r.kind, gate: r.kind === "human" ? "human" : r.gate, topN: r.topN })),
    offerGate: plan.offerGate,
  };
}

/** Structural equality against the last-saved wire shape — drives the dirty
 *  state that gates the Save button. */
export function planEqualsStored(plan: PipelinePlan, stored: InterviewPlanRule): boolean {
  return JSON.stringify(toStoredPlan(plan)) === JSON.stringify(stored);
}

/** Does the composed plan match a preset structurally (ids ignored)? Used to
 *  highlight the active blueprint card after fine-tuning. */
export function matchesPreset(plan: PipelinePlan, preset: Preset): boolean {
  const p = preset.plan();
  return (
    plan.screeningGate === p.screeningGate &&
    plan.offerGate === p.offerGate &&
    plan.rounds.length === p.rounds.length &&
    plan.rounds.every((r, i) => r.kind === p.rounds[i].kind && r.gate === p.rounds[i].gate && r.topN === p.rounds[i].topN)
  );
}
