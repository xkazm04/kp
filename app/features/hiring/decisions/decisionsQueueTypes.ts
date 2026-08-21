// Shared types + tiny pure helpers for the Decisions queue, used by both
// useDecisionsQueue.ts and DecisionsTab.tsx. Split out so neither file needs
// to redeclare them.
import type { Entry } from "@/app/features/shared/decisionsTypes";
import type { MatchScoreProvenance } from "@/app/_lib/match-score";

export type Group = { roleKey: string; roleTitle: string; jobId: string | null; entries: Entry[] };

// The sealed auto-reject reason the wave wrote, read back for display: a
// structured code + its interpolation params, localized on the client through the
// same decisions.wave.reasons.* catalog the screen-wave modal uses.
export type ReconsiderReason = { reasonCode: string; reasonParams: Record<string, string | number> };

// idea-e43fa801 — an auto-rejected candidate a recruiter can put back for review.
export type ReconsiderRow = {
  id: string;
  candidateLabel: string;
  jobTitle: string | null;
  archetype: string | null;
  matchScore: number | null;
  // The canonical score's provenance, so the row can name where the number came
  // from (CV analysis · date / snapshot) exactly like the rest of the decisions UI.
  scoreProvenance: MatchScoreProvenance | null;
  rejectedAt: string | null;
  // reconsider-earns-keep — the machine reject reason, read back from the sealed
  // decision record. Null when no seal was found (best-effort).
  reason: ReconsiderReason | null;
};

export const roleKeyOf = (e: Entry) => e.jobId ?? e.jobTitle ?? "unassigned";

// The approval kinds THIS tab decides — the key-decision gate plus the four AI
// review gates it renders as cards. `calendar` (the sixth kind in
// app/_lib/approval-kinds.ts) is deliberately NOT one of them: it is the
// interview-scheduling gate the Schedule tab owns, and it is what THIS tab's own
// accept path produces (accepting a screening flips approvalKind to "calendar"
// server-side — the handoff the queued-for-Schedule banner narrates). Counting it
// as pending here left the header reading "3 pending" over 2 rendered cards and the
// role dropdown reading "Backend Dev (3)", and — once only calendar entries were
// left — stopped the queue from ever reaching its "all caught up" empty state.
export const DECISIONS_QUEUE_KINDS = [
  "decision",
  "screening_review",
  "scorecard_review",
  "rejection_review",
  "offer_review",
] as const;

const QUEUE_KINDS: ReadonlySet<string> = new Set<string>(DECISIONS_QUEUE_KINDS);

/** Is this entry waiting on a decision this tab actually renders? The ONE population
 *  behind the header count, the role-filter counts and the "all caught up" empty
 *  state, so none of them can be computed on a different denominator than the cards. */
export function isDecisionsQueueEntry(e: Pick<Entry, "status" | "approvalKind">): boolean {
  return e.status === "active" && e.approvalKind != null && QUEUE_KINDS.has(e.approvalKind);
}
