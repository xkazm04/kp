import type { StageAiAction } from "@/app/_lib/pipeline-stages";
import type { Entry as PipelineEntry } from "@/app/features/shared/pipelineTypes";

// The candidate modal's per-entry state (candidate/state/) needs only a subset of
// the board's record — the narrow Pick the drawer used, kept under its old name. Pick it from the canonical
// PipelineTypes.Entry instead of re-declaring the fields, so a rename or retype on
// the board surfaces here as a compile error rather than a silently stale copy.
export type Entry = Pick<
  PipelineEntry,
  | "id"
  | "candidateId"
  | "candidateLabel"
  | "archetype"
  | "roleFamily"
  | "jobId"
  | "jobTitle"
  | "stage"
  | "matchScore"
  | "canonicalScore"
  | "scoreProvenance"
  | "transferScore"
  | "status"
  | "intakeDegraded"
  | "intakeDegradedReason"
  | "githubEvidence"
  | "githubHandle"
  | "notes"
  | "sourceChannel"
  | "sourceCampaign"
  | "sourceVariant"
>;

export type TaskId = StageAiAction;

// note-truth-unification — the notes payload the automation task carries. ONE source
// of truth: only the "Synthesize scorecard" task consumes the recruiter's persistent
// candidate note, fed its LIVE value at click time (the drawer passes `candNote`, which
// includes unsaved edits); every other task sends none. Previously a SECOND, transient
// textarea seeded from entry.notes at mount fuelled this — so a recruiter typing call
// facts into the visible persistent box had the AI synthesize from the stale transient
// copy. Pure so the "scorecard consumes the note, nothing else does" contract is
// unit-pinned without rendering the drawer.
export function scorecardTaskNotes(task: TaskId, note: string): string | undefined {
  return task === "scorecard" ? note : undefined;
}

export type Result = { task: TaskId; data: Record<string, unknown>; source: string; applied: string };

// The English SOURCE of the applied-outcome labels — a fallback map, never the
// rendered value: ResultView reads `pipeline.applied.<key>` and only falls back
// here for an outcome the catalog doesn't carry yet (the same has-fallback idiom
// as other transitional outcome maps). Keep the two in step when adding an outcome.
export const APPLIED_LABEL: Record<string, string> = {
  advanced: "Advanced a stage.",
  held_for_review: "Held for your review in Decisions.",
  scorecard_ready: "Scorecard sent to Decisions.",
  offer_ready: "Offer drafted — approve it in Decisions.",
  rematched: "Alternative role added to the pipeline.",
  no_alternative: "No alternative role above the match floor.",
  advisory: "Advisory only — candidate is past the screening gate.",
  drafted: "Draft ready to copy.",
};

// The pipeline drawer's frozen GitHub evidence card (PipelineGithubEvidenceCard.tsx),
// the part node:test can hold. Kept in this module, not one of its own, so the
// workspace page's import graph does not grow.
//
// The repo-signal review's `unverifiedClaims` are skills it did not SEE in public
// repo signals. Public work can confirm a skill but never rule one out (registry:
// recruiting/public-work-evidence-bounding, corroborate-a-claim-never-replace-it),
// so the card labels that list "Not seen in public repos" in a neutral token. It
// used to sit under an amber "Unverified claims:", which read absence of public
// evidence as the candidate's claim being false. The analysis panel's skill ledger
// (app/_lib/github/skill-ledger.ts) calls the same bucket "Not reached".

export const GITHUB_NOT_SEEN_KEY = "githubNotSeen" as const;
export const GITHUB_NOT_SEEN_TITLE_KEY = "githubNotSeenTitle" as const;
export const GITHUB_NOT_SEEN_CLASS = "font-semibold text-steel";

/**
 * The review's not-seen skills, trimmed and de-duplicated case-insensitively, minus
 * any skill the same review evidenced (one skill never sits in both lists).
 */
export function notSeenInPublicRepos(summary: {
  confirmedSkills: readonly string[];
  unverifiedClaims: readonly string[];
}): string[] {
  const seen = new Set(summary.confirmedSkills.map((s) => s.trim().toLowerCase()));
  const out: string[] = [];
  for (const raw of summary.unverifiedClaims) {
    const label = raw.trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}
