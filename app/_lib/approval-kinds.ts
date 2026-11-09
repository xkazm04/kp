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

// A POLICY ADVANCE queued for a person (Q2, owner ruling 2026-11-09). The score-threshold
// advances of the policy pass (entry column, and screening column after its settling days)
// are no longer applied by the pass: it files a `screening_review` approval whose payload
// carries `policyAdvance` and the policy's own reason as `rationale`. No new kind and no
// new queue: a person's accept resolves it through the ordinary accept (one stage, sealed
// as a human decision with the machine's verdict beside it). The kind is reused rather than
// added because every surface that renders or resolves a screening review already handles
// it; the marker is what lets a card say "advance" instead of "review".
export type PolicyAdvanceMark = { toStage: string | null };

/** The `approval_detail` of a queued policy advance. `confidence` is the match score the
 *  policy read, the same number a queued reject carries. */
export function policyAdvanceDetail(input: { rationale: string; toStage: string | null; matchScore: number | null }): string {
  return JSON.stringify({
    recommendation: "advance",
    confidence: input.matchScore,
    rationale: input.rationale,
    policyAdvance: { toStage: input.toStage } satisfies PolicyAdvanceMark,
  });
}

/** The queued policy advance an approval carries, or null (any other approval, or an
 *  unparseable payload). Pure and client-safe. */
export function parsePolicyAdvance(approvalKind: string | null | undefined, approvalDetail: string | null | undefined): PolicyAdvanceMark | null {
  if (approvalKind !== "screening_review" || !approvalDetail) return null;
  try {
    const mark = (JSON.parse(approvalDetail) as { policyAdvance?: { toStage?: unknown } } | null)?.policyAdvance;
    if (!mark || typeof mark !== "object") return null;
    return { toStage: typeof mark.toStage === "string" ? mark.toStage : null };
  } catch {
    return null;
  }
}

/** Event detail of a person's decline of a queued policy advance. The policy reads it
 *  (since the entry's last stage move) so the same entry is not proposed again. */
export const ADVANCE_DECLINED_DETAIL = "advance_declined";

/** Whether an entry is waiting on a human (any recognized approval kind is set).
 *  Mirrors PipelineTab's "non-null kind = needs a human" rule, but rejects an
 *  unrecognized kind so a typo can't masquerade as a real gate. */
export function needsHumanDecision(kind: string | null | undefined): boolean {
  return isApprovalKind(kind);
}
