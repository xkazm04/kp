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
  | "sourceCampaign"
  | "sourceVariant"
>;

export type TaskId = "screen" | "outreach" | "rejection" | "prep" | "scorecard" | "rematch" | "offer";

// note-truth-unification — the notes payload the automation task carries. ONE source
// of truth: only the "Synthesize scorecard" task consumes the recruiter's persistent
// candidate note, fed its LIVE value at click time (the drawer passes `candNote`, which
// includes unsaved edits); every other task sends none. Previously a SECOND, transient
// textarea seeded from entry.notes at mount fuelled this — so a recruiter typing call
// facts into the visible persistent box had the AI synthesize from the stale transient
// copy. Pure so the "scorecard consumes the note, nothing else does" contract is
// unit-pinned without rendering the drawer.
export function scorecardTaskNotes(task: TaskId, note: string): string | undefined {
  return task === "scorecard" ? note : undefined;
}

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
