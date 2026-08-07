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

export function isApprovalKind(value: string | null | undefined): value is ApprovalKind {
  return value != null && (APPROVAL_KINDS as readonly string[]).includes(value);
}

/** Whether an entry is waiting on a human (any recognized approval kind is set).
 *  Mirrors PipelineTab's "non-null kind = needs a human" rule, but rejects an
 *  unrecognized kind so a typo can't masquerade as a real gate. */
export function needsHumanDecision(kind: string | null | undefined): boolean {
  return isApprovalKind(kind);
}
