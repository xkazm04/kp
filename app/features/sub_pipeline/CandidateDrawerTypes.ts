export type Entry = {
  id: string;
  candidateId: string | null;
  candidateLabel: string;
  archetype: string | null;
  jobId: string | null;
  jobTitle: string | null;
  stage: string;
  matchScore: number | null;
  status: string;
  // Label-only stub from a failed intake normalization, needing manual capture.
  intakeDegraded?: boolean;
  intakeDegradedReason?: string | null;
};

export type TaskId = "screen" | "outreach" | "rejection" | "prep" | "scorecard" | "rematch" | "offer";

export type Result = { task: TaskId; data: Record<string, unknown>; source: string; applied: string };

export const ARCHETYPE: Record<string, { label: string; bg: string }> = {
  bau: { label: "Experienced", bg: "bg-steel" },
  student: { label: "Student", bg: "bg-coral" },
  career_switcher: { label: "Switcher", bg: "bg-moss" },
};

export const APPLIED_LABEL: Record<string, string> = {
  advanced: "Advanced a stage.",
  held_for_review: "Held for your review in Decisions.",
  scorecard_ready: "Scorecard sent to Decisions.",
  offer_ready: "Offer drafted — approve it in Decisions.",
  rematched: "Alternative role added to the pipeline.",
  no_alternative: "No alternative role above the match floor.",
  advisory: "Advisory only — candidate is past the screening gate.",
  drafted: "Draft ready to copy.",
};
