export const SCORING_GRACE_MS = 5 * 60 * 1000; // 5 minutes

export type InterviewScoringState = "scored" | "scoring" | "unscored" | "not_scorable";

export interface InterviewScoringRow {
  mode?: string | null;
  status?: string | null;
  hasTranscript?: boolean | null;
  hasScorecard?: boolean | null;
  endedAt?: string | null;
}

/**
 * Derives the single explicit scoring state for an interview session row.
 * Shared by server refusal checks and client Schedule surfaces so they cannot disagree.
 */
export function interviewScoringState(
  row: InterviewScoringRow,
  nowMs: number = Date.now()
): InterviewScoringState {
  if (row.mode !== "candidate" || row.status !== "completed" || !row.hasTranscript) {
    return "not_scorable";
  }
  if (row.hasScorecard) {
    return "scored";
  }
  if (row.endedAt) {
    const ended = new Date(row.endedAt).getTime();
    if (!Number.isNaN(ended) && nowMs - ended < SCORING_GRACE_MS) {
      return "scoring";
    }
  }
  return "unscored";
}
