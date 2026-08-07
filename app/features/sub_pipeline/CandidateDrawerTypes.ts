import type { Entry as PipelineEntry } from "./PipelineTypes";

// The drawer needs only a subset of the board's record. Pick it from the canonical
// PipelineTypes.Entry instead of re-declaring the fields, so a rename or retype on
// the board surfaces here as a compile error rather than a silently stale copy.
export type Entry = Pick<
  PipelineEntry,
  | "id"
  | "candidateId"
  | "candidateLabel"
  | "archetype"
  | "roleFamily"
  | "jobId"
  | "jobTitle"
  | "stage"
  | "matchScore"
  | "canonicalScore"
  | "scoreProvenance"
  | "status"
  | "intakeDegraded"
  | "intakeDegradedReason"
  | "githubEvidence"
  | "githubHandle"
  | "notes"
  | "sourceChannel"
>;

export type TaskId = "screen" | "outreach" | "rejection" | "prep" | "scorecard" | "rematch" | "offer";

export type Result = { task: TaskId; data: Record<string, unknown>; source: string; applied: string };

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
