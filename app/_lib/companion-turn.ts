// Pure helpers for one operator-companion turn (docs/features/companion/README.md).
//
// Deliberately dependency-free: no db slice, no node:fs, no next/server. The
// route and companion-run.ts do the I/O and call these, so the clamp, the
// transcript window, the derived title and the grounding SUMMARY can be unit
// tested without opening a database or resolving next/server — which is the
// difference between a test that runs and one that is written and never runs.

/** The route's request clamp. Matches MAX_MESSAGE_CHARS in companion_cli.py, so
 *  a message that survives the route is never silently re-truncated by Python. */
export const MAX_COMPANION_MESSAGE_CHARS = 4_000;

/** The transcript window handed to the model. Matches MAX_TRANSCRIPT_TURNS in
 *  companion_cli.py — sending more would be paid for and then dropped. */
export const COMPANION_TRANSCRIPT_TURNS = 12;

/** Bound + trim an untrusted message body. Empty (or non-string) → "" so the
 *  caller answers 400 rather than spawning Python for nothing. */
export function clampCompanionMessage(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().slice(0, MAX_COMPANION_MESSAGE_CHARS) : "";
}

/** Thread titles are DERIVED, never typed (the store's contract). The operator's
 *  first message is the honest name for the conversation; cut on a word boundary
 *  so a title never ends mid-word, and never past the store's 200-char column. */
export function deriveThreadTitle(message: string): string {
  const flat = message.replace(/\s+/g, " ").trim();
  if (flat.length <= 60) return flat;
  const cut = flat.slice(0, 60);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 24 ? cut.slice(0, lastSpace) : cut).trim();
}

export type CompanionWireTurn = { role: string; content: string };

/** The last N turns, oldest-first, in the shape companion_cli.py reads. */
export function transcriptWindow(
  turns: readonly CompanionWireTurn[],
  limit = COMPANION_TRANSCRIPT_TURNS
): CompanionWireTurn[] {
  return turns.slice(-limit).map((turn) => ({ role: turn.role, content: turn.content }));
}

// ---- grounding ------------------------------------------------------------

/** The slice of a pipeline entry the summary reads. Structural on purpose: the
 *  caller passes real PipelineEntry rows and this module never imports the store. */
export type CompanionPipelineRow = {
  stage: string;
  status: string;
  jobTitle: string | null;
  matchScore: number | null;
  /** Candidate display label. Optional so leaner projections still summarize. */
  candidateLabel?: string | null;
};

export type CompanionPipelineSummary = {
  activeEntries: number;
  byStage: Record<string, number>;
  /** The busiest roles by active-entry count — what the operator is actually hiring for.
   *  Each carries its top candidates (label, score, stage) so comparison questions can
   *  be answered as a table instead of a shrug. */
  topRoles: { role: string; entries: number; candidates: { label: string; matchScore: number | null; stage: string }[] }[];
  /** Mean match score across active entries that have one, rounded. Null when none do. */
  meanMatchScore: number | null;
};

const TOP_ROLES = 5;

const TOP_CANDIDATES_PER_ROLE = 5;

/** A compact, factual picture of the board — small enough to sit in every prompt,
 *  specific enough that the companion can answer "what needs me" without guessing.
 *  Candidate labels are deliberately PRESENT (decision 2026-08-24, prototype round
 *  2 triage): this is an operator-only surface behind the same auth as the board
 *  itself, and without labels the flagship question — "compare my top candidates"
 *  — is unanswerable. Capped at the busiest roles × top candidates by score. */
export function pipelineSummary(rows: readonly CompanionPipelineRow[]): CompanionPipelineSummary {
  const active = rows.filter((r) => r.status === "active");
  const byStage: Record<string, number> = {};
  const byRole = new Map<string, CompanionPipelineRow[]>();
  let scoreSum = 0;
  let scored = 0;
  for (const row of active) {
    byStage[row.stage] = (byStage[row.stage] ?? 0) + 1;
    const role = (row.jobTitle ?? "").trim();
    if (role) byRole.set(role, [...(byRole.get(role) ?? []), row]);
    if (typeof row.matchScore === "number" && Number.isFinite(row.matchScore)) {
      scoreSum += row.matchScore;
      scored += 1;
    }
  }
  const topRoles = [...byRole.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, TOP_ROLES)
    .map(([role, entries]) => ({
      role,
      entries: entries.length,
      candidates: entries
        .slice()
        .sort((a, b) => (b.matchScore ?? -1) - (a.matchScore ?? -1))
        .slice(0, TOP_CANDIDATES_PER_ROLE)
        .map((r) => ({ label: (r.candidateLabel ?? "").trim() || "(unlabeled)", matchScore: r.matchScore, stage: r.stage })),
    }));
  return {
    activeEntries: active.length,
    byStage,
    topRoles,
    meanMatchScore: scored > 0 ? Math.round(scoreSum / scored) : null,
  };
}
