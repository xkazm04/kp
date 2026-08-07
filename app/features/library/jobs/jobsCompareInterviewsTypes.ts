// Shared types + style maps for the JobsCompareInterviews split — extracted
// verbatim so the tab file stays under the 200-line split threshold.
import type { InterviewRecommendation } from "@/app/_lib/interview-recommendation";
import type { Scorecard, ScorecardRating } from "@/app/_lib/interview-scorecard";
import type { InterviewTelemetry } from "@/app/_lib/interview-telemetry";

export type Candidate = {
  entryId: string | null;
  candidateLabel: string | null;
  recommendation: InterviewRecommendation | null;
  summary: string | null;
  scoringModel: string;
  confidence: { level: string; reason?: string } | null;
  ratings: ScorecardRating[];
  // Skills this interview minted as observed-provenance evidence (the
  // case-grounded gates) — the highest-trust artifact, stamped visibly below.
  observedSkills: string[];
  // A recruiter's human scorecard for this candidate (PREP1), if one was filled —
  // shown beside the AI screen so a human-led round isn't invisible here.
  humanScorecard?: Scorecard | null;
  // True for a candidate whose round was HUMAN-led (human scorecard, no voice
  // session) — their blank AI ratings mean "not AI-interviewed", not "synthesis
  // failed", and the chip below says so.
  humanOnly?: boolean;
  // Deterministic call telemetry (talk share, longest pause, hint uptake) attached
  // to the AI scorecard — DESCRIPTIVE conversational-dynamics signals, rendered
  // neutrally below the verdict badges. Null for a human-led / legacy round.
  telemetry?: InterviewTelemetry | null;
};

// Keyed by the InterviewRecommendation union so every canonical verdict is
// styled (a new verdict in the contract is a compile error here until handled).
export const REC_STYLE: Record<InterviewRecommendation, string> = {
  advance: "bg-moss/15 text-moss",
  hold: "bg-dial-amber/20 text-ink",
  reject: "bg-coral/10 text-coral",
};
export const CONF_STYLE: Record<string, string> = {
  tight: "text-moss",
  moderate: "text-steel",
  wide: "text-dial-amber",
};
export const ratingColor = (r: number) =>
  r >= 4 ? "bg-moss/15 text-moss" : r <= 2 ? "bg-coral/10 text-coral" : "bg-stone-100 text-ink";
