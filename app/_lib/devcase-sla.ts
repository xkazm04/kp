// Staleness rule for dev-case lifecycles stalled at collecting (idea-d8a0c4cf). A
// lifecycle that reaches "collecting" with zero submissions returns and sits
// indefinitely — reconcile only re-enqueues non-terminal RUNS, nothing flags a
// posting that's been open and empty for days. This is the pure predicate behind
// the flag: an open lifecycle with no submissions, older than the threshold, is
// stalled and wants a re-source or a close.
//
// Pure + import-free so the threshold contract is unit-testable.

// Default age (days) after which an empty, still-open lifecycle is stalled.
export const STALE_COLLECTING_DAYS = 7;

// The post-publish stages where a posting is OPEN and accepting submissions —
// "collecting" is the canonical one; "published" covers a just-gone-live row that
// hasn't ticked to collecting yet. (intake/analyzed/designed aren't open;
// ranked/promoted have already moved on.)
const OPEN_STAGES = new Set(["collecting", "published"]);

export type LifecycleStall = { stalled: boolean; ageDays: number | null };

export function lifecycleStall(
  input: { stage: string; updatedAt?: string | null; createdAt: string; submissionCount: number },
  nowMs: number,
  thresholdDays: number = STALE_COLLECTING_DAYS
): LifecycleStall {
  // Only open-and-empty lifecycles can stall; anything with a submission, or past
  // the open stages, is doing its job.
  if (!OPEN_STAGES.has(input.stage) || input.submissionCount > 0) return { stalled: false, ageDays: null };
  const since = Date.parse(input.updatedAt || input.createdAt);
  if (!Number.isFinite(since)) return { stalled: false, ageDays: null };
  const ageDays = (nowMs - since) / 86_400_000;
  return { stalled: ageDays >= thresholdDays, ageDays: Math.max(0, Math.floor(ageDays)) };
}
