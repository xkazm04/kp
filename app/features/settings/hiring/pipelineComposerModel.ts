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
import { DEFAULT_STAGE_AXIS, stagesWithRole, stageWithRole, type StageDef } from "@/app/_lib/pipeline-stages";

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

/** One column of the REAL board, annotated with what this plan runs there. */
export type PlanOverviewStation = {
  /** A stage id from the axis — the same id PipelineBoard renders as a column. */
  stageId: string;
  role: StageDef["role"];
  /** The plan's rounds that execute at this stage, in order. Empty for stages the
   *  plan says nothing about (the entry column, the terminal column). */
  rounds: RoundKind[];
};

/** What each Hiring tab would show under this plan — structured facts, the
 *  components own the copy. */
export type PlanImpact = {
  /** The Overview board's columns, in board order, annotated per station. */
  overview: PlanOverviewStation[];
  /** Human queues appearing in Decisions, in pipeline order. */
  decisions: ("screening_review" | "ai_scorecard_review" | "human_scorecard_review" | "offer_review")[];
  /** Which Schedule surfaces are in play. */
  schedule: { aiRound: boolean; humanRound: boolean };
  /** Human decision points per candidate who goes the distance. */
  humanTouchpoints: number;
};

/**
 * Derive the impact of a plan ON THE ACTUAL BOARD.
 *
 * This used to emit its own private vocabulary — `screened → ai_interview →
 * human_interview → offer → hired` — under a panel headed "Overview". The real
 * Overview renders `Accepted → Screened → Interview → Offer → Hired`, so the
 * preview was three things wrong at once: it omitted the entry column, it
 * invented an AI/human interview split the board has no columns for, and it
 * labelled everything from `hiringPlan.impact.ov*` while the board's headers come
 * from `enums.stage.*`. Whatever it was showing, it was not a preview.
 *
 * Now it walks the board axis itself and annotates each column with the rounds
 * the plan runs there. Where a plan declares more rounds than the axis has
 * interview stages — the default plan does exactly this: two rounds, one
 * `Interview` column — the extra rounds stack onto the last interview stage and
 * the preview SAYS SO rather than inventing a column. That is the honest picture
 * of today's product: the hybrid handoff runs a second round without moving the
 * candidate off the Interview column.
 */
export function deriveImpact(plan: PipelinePlan, axis: readonly StageDef[] = DEFAULT_STAGE_AXIS): PlanImpact {
  const interviewStages = stagesWithRole("interview", axis);
  // Rounds bind to interview stages left-to-right; any surplus stacks on the last
  // one (see the doc comment). A plan with rounds and an axis with no interview
  // stage at all drops them onto no station — the board genuinely has nowhere to
  // draw them, and pretending otherwise is what this rewrite exists to stop.
  const roundsByStage = new Map<string, RoundKind[]>();
  plan.rounds.forEach((round, i) => {
    const stageId = interviewStages[Math.min(i, interviewStages.length - 1)];
    if (!stageId) return;
    roundsByStage.set(stageId, [...(roundsByStage.get(stageId) ?? []), round.kind]);
  });

  const overview: PlanOverviewStation[] = axis.map((stage) => ({
    stageId: stage.id,
    role: stage.role,
    rounds: roundsByStage.get(stage.id) ?? [],
  }));

  const decisions: PlanImpact["decisions"] = [];
  if (plan.screeningGate === "human") decisions.push("screening_review");
  for (const r of plan.rounds) {
    if (r.kind === "human") decisions.push("human_scorecard_review");
    else if (r.gate === "human") decisions.push("ai_scorecard_review");
  }
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

/** The board stage each fixed composer row governs, so the Settings table names
 *  the same columns the board draws instead of its own private station words. */
export const COMPOSER_STATIONS = {
  screening: stageWithRole("screening"),
  interview: stagesWithRole("interview"),
  offer: stageWithRole("offer"),
} as const;

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
