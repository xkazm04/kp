import archetypeRegistry from "@/pipeline/jobfit/archetypes.json";
import { SIM_PHASES, type SimPhaseId } from "./constants";

// The decision-criteria reference rendered under the diagram in the explainer
// drawer. It documents the factors every pipeline decision is built from — what
// the pipeline weighs and where each signal comes from — and POPULATES as the
// walkthrough advances: each criterion carries the phase it's first gathered at,
// so the table fills top-to-bottom in step with the simulation.
//
// Grounded in the real pipeline, not invented:
//   * Seniority / Languages / Education — the KO gates ko_filter() applies when
//     the sourced pool is first filtered (pipeline/jobfit/matching.py).
//   * Skills / Career / Contextual fit — the weighted dimensions score_job()
//     blends; their weight tier is read from the shared registry's BAU profile
//     (archetypes.json), so re-tuning the weights there re-tiers this table.
//   * Interview scorecard / Compensation — the human-stage signals the later
//     phases add (AI voice screen + scorecard; band-midpoint offer).

/** One-word importance tier shown in the Weight column. Its label is read from
 *  `simulation.weight.<tier>` at the render boundary. */
export type CriterionWeight = "critical" | "medium" | "minor";

/** Stable identity of a decision factor. The row's NAME and SOURCE are copy, so
 *  they live in `simulation.criteria.<id>.{name,source}` rather than here — the
 *  explainer drawer is part of the public guided demo and reads in four
 *  languages. */
export type CriterionId =
  | "seniority"
  | "languages"
  | "education"
  | "skills"
  | "career"
  | "contextual"
  | "scorecard"
  | "compensation";

export type DecisionCriterion = {
  /** The decision factor's stable id, e.g. "skills" -> "Skills match". */
  id: CriterionId;
  /** One-word influence on the outcome (see CriterionWeight). */
  weight: CriterionWeight;
  /** The phase at which this criterion enters the decision. The table reveals
   *  it once the walkthrough reaches this step. */
  phase: SimPhaseId;
};

type RegistryArchetype = {
  id: string;
  weights: Record<string, number>;
};

const BAU = (archetypeRegistry.archetypes as RegistryArchetype[]).find((a) => a.id === "bau");

// Project a 0-1 dimension weight onto the one-word tier the table renders. The
// thresholds bracket the BAU split (skills .50 / career .35 / personal .15) so
// the dominant dimension reads "critical" and the smallest "minor".
function weightTier(w: number): CriterionWeight {
  if (w >= 0.45) return "critical";
  if (w >= 0.25) return "medium";
  return "minor";
}

const tier = (key: string, fallback: CriterionWeight): CriterionWeight =>
  BAU ? weightTier(BAU.weights[key] ?? 0) : fallback;

// Ordered by the phase each criterion is gathered, so the table grows top-to-
// bottom as the walkthrough progresses through the pipeline.
export const DECISION_CRITERIA: DecisionCriterion[] = [
  { id: "seniority", weight: "critical", phase: "source" },
  { id: "languages", weight: "critical", phase: "source" },
  { id: "education", weight: "medium", phase: "source" },
  { id: "skills", weight: tier("skills", "critical"), phase: "match" },
  { id: "career", weight: tier("career", "medium"), phase: "screen" },
  { id: "contextual", weight: tier("personal", "minor"), phase: "screen" },
  { id: "scorecard", weight: "critical", phase: "interview" },
  { id: "compensation", weight: "medium", phase: "offer" },
];

// Stable phase ordering (design → … → hired) for cumulative reveal.
const PHASE_ORDER: SimPhaseId[] = SIM_PHASES.map((p) => p.id);

/** Criteria gathered up to and including `phase`, in phase order. `design` (and
 *  a null phase) reveal nothing — the JD is still being authored, so no
 *  candidate has been judged yet. */
export function criteriaThroughPhase(phase: SimPhaseId | null): DecisionCriterion[] {
  if (!phase) return [];
  const reached = PHASE_ORDER.indexOf(phase);
  return DECISION_CRITERIA.filter((c) => PHASE_ORDER.indexOf(c.phase) <= reached);
}

// Weight tier -> dot color. Reuses the brand tokens: coral marks the high-stakes
// signals, amber the mid tier, steel the minor nudge. The tier's WORD is copy and
// comes from `simulation.weight.<tier>`; the dot is the color half of the same
// non-color-only cue.
export const CRITERION_WEIGHT_DOT: Record<CriterionWeight, string> = {
  critical: "bg-coral",
  medium: "bg-dial-amber",
  minor: "bg-steel",
};
