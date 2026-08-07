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
