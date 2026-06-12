// Single documented taxonomy for a pipeline entry's `approvalKind` — the flag
// that marks an entry as waiting on a human and routes it to the right surface.
// The values used to be free-form strings scattered across seed_pipeline.py,
// db.ts and the pipeline routes with no central definition of the full set,
// which surface raises each, or how acting on it resolves. PipelineTab treats
// ANY non-null kind as "needs a human", but only specific kinds have real
// advance logic in actOnPipelineEntry — this registry makes that explicit.

export const APPROVAL_KINDS = [
  "decision",
  "screening_review",
  "scorecard_review",
  "rejection_review",
  "offer_review",
  "calendar",
] as const;

export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

type ApprovalKindMeta = {
  /** Human label for the kind. */
  label: string;
  /** Where the entry shows up / which UI raises it. */
  surfacedBy: string;
  /** How acting on it resolves (which handler / action advances it). */
  resolvedBy: string;
};

// One row per kind: what surfaces it and how it resolves. Producers that WRITE a
// kind (seed_pipeline.py, setApproval, the policy passes) and consumers that READ
// it (DecisionsTab, ScheduleTab, the pipeline routes) should all agree with this.
export const APPROVAL_KIND_META: Record<ApprovalKind, ApprovalKindMeta> = {
  decision: {
    label: "Key decision",
    surfacedBy: "Decisions tab — Key decisions, grouped by role",
    resolvedBy: "accept/reject via actOnPipelineEntry from the analysis summary",
  },
  screening_review: {
    label: "AI screening review",
    surfacedBy: "Decisions tab — AI recommendations",
    resolvedBy: "accept advances to Interview (+ interview-prep task); reject ends it",
  },
  scorecard_review: {
    label: "Interview scorecard review",
    surfacedBy: "Decisions tab — AI recommendations / Schedule tab once a transcript exists",
    resolvedBy: "accept/reject via actOnPipelineEntry after the interview",
  },
  rejection_review: {
    label: "Queued auto-reject (supervised clock)",
    surfacedBy: "Decisions tab — AI recommendations; raised by the policy pass when reject_mode='approve' (AUTO1)",
    resolvedBy: "reject ratifies (human route sends the rejection email); accept overrules and advances",
  },
  offer_review: {
    label: "Offer review",
    surfacedBy: "Decisions tab — AI recommendations (entry at the Offer stage)",
    resolvedBy: "accept sends the offer; handled in pipeline/[id] route",
  },
  calendar: {
    label: "Interview slot",
    surfacedBy: "Schedule tab — calendar picker",
    resolvedBy: "confirming a slot via the schedule flow",
  },
};

export function isApprovalKind(value: string | null | undefined): value is ApprovalKind {
  return value != null && (APPROVAL_KINDS as readonly string[]).includes(value);
}

/** Whether an entry is waiting on a human (any recognized approval kind is set).
 *  Mirrors PipelineTab's "non-null kind = needs a human" rule, but rejects an
 *  unrecognized kind so a typo can't masquerade as a real gate. */
export function needsHumanDecision(kind: string | null | undefined): boolean {
  return isApprovalKind(kind);
}
