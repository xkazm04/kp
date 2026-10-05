// Pure candidate selection and summary logic for DevCase database sourcing.

export type CandidatePreviewRow = {
  candidateId?: string | null;
  label: string;
  archetype?: string | null;
  score?: number | null;
  matchedSkills?: readonly string[];
  onBoard?: { status: string; stage?: string } | null;
};

/**
 * Validates candidateIds from a POST body. Must be a non-empty array of non-empty strings.
 * Returns the normalized array or null if invalid.
 */
export function validateCandidateIds(candidateIds: unknown): string[] | null {
  if (!Array.isArray(candidateIds) || candidateIds.length === 0) return null;
  const out: string[] = [];
  for (const id of candidateIds) {
    if (typeof id !== "string") return null;
    const trimmed = id.trim();
    if (trimmed.length === 0) return null;
    out.push(trimmed);
  }
  return out;
}

/**
 * Default picks for preview: selects every candidate who is not already on the board.
 */
export function defaultPicks(rows: readonly CandidatePreviewRow[]): string[] {
  const picks: string[] = [];
  for (const row of rows) {
    if (row.candidateId && row.onBoard == null) {
      picks.push(row.candidateId);
    }
  }
  return picks;
}

export type CommitSummaryResult = {
  key: "filed" | "nothingNew" | "dropped";
  added: number;
  alreadyOnBoard: number;
  dropped: number;
};

/**
 * Maps the commit outcome to the catalog key and counts the panel renders.
 * 'filed' = at least 1 new candidate filed
 * 'nothingNew' = 0 added, all candidates were already on the board
 * 'dropped' = 0 added and some selected candidates dropped / no longer match
 */
export function commitSummary({
  added,
  alreadyOnBoard,
  dropped = [],
}: {
  added: number;
  alreadyOnBoard: number;
  dropped?: readonly string[];
}): CommitSummaryResult {
  const droppedCount = dropped.length;
  if (added > 0) {
    return {
      key: "filed",
      added,
      alreadyOnBoard,
      dropped: droppedCount,
    };
  }
  if (droppedCount > 0 && added === 0) {
    return {
      key: "dropped",
      added: 0,
      alreadyOnBoard,
      dropped: droppedCount,
    };
  }
  return {
    key: "nothingNew",
    added: 0,
    alreadyOnBoard,
    dropped: droppedCount,
  };
}
