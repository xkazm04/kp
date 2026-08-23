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
};

export type CompanionPipelineSummary = {
  activeEntries: number;
  byStage: Record<string, number>;
  /** The busiest roles by active-entry count — what the operator is actually hiring for. */
  topRoles: { role: string; entries: number }[];
  /** Mean match score across active entries that have one, rounded. Null when none do. */
  meanMatchScore: number | null;
};

const TOP_ROLES = 5;

/** A compact, factual picture of the board — small enough to sit in every prompt,
 *  specific enough that the companion can answer "what needs me" without guessing.
 *  Names and candidate labels are deliberately ABSENT: the grounding blob leaves
 *  the machine with the model, and a stage histogram is not a candidate record. */
export function pipelineSummary(rows: readonly CompanionPipelineRow[]): CompanionPipelineSummary {
  const active = rows.filter((r) => r.status === "active");
  const byStage: Record<string, number> = {};
  const byRole = new Map<string, number>();
  let scoreSum = 0;
  let scored = 0;
  for (const row of active) {
    byStage[row.stage] = (byStage[row.stage] ?? 0) + 1;
    const role = (row.jobTitle ?? "").trim();
    if (role) byRole.set(role, (byRole.get(role) ?? 0) + 1);
    if (typeof row.matchScore === "number" && Number.isFinite(row.matchScore)) {
      scoreSum += row.matchScore;
      scored += 1;
    }
  }
  const topRoles = [...byRole.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_ROLES)
    .map(([role, entries]) => ({ role, entries }));
  return {
    activeEntries: active.length,
    byStage,
    topRoles,
    meanMatchScore: scored > 0 ? Math.round(scoreSum / scored) : null,
  };
}
