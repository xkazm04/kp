import type { Analysis } from "@/app/_lib/schemas";
import { reconcileScoreTotal } from "@/app/_lib/format";
import type { PipelineRef } from "@/app/_components/results/AddToPipelineButton";

// Direction 1 — "add to pipeline at the moment of intent". The saved-report page
// (history/[slug]/page.tsx) builds a PipelineRef from the persisted row and hands
// it to ResultPanel, which renders the shared AddToPipelineButton. The LIVE
// Analyze result had no such ref, so the recruiter's moment of decision dead-ended
// at History. This derives the SAME ref from the live analysis, reusing the exact
// fields the report page passes — so both surfaces file the candidate identically
// (same candidateId = analysis slug, same label the on-board chip matches by, same
// jobId the board keys lanes on). Pure + render-free so it unit-tests under Node.
export type AnalyzePipelineAffordance =
  // The run is board-addable: show the shared Add-to-pipeline button.
  | { kind: "add"; ref: PipelineRef }
  // The run can't be filed under a job — show an HONEST disabled affordance with a
  // one-line reason instead of a hidden button. `jdless`: no saved JD (the board
  // keys lanes by job); `unsaved`: the analysis didn't persist, so there's no row
  // to address.
  | { kind: "disabled"; reason: "jdless" | "unsaved" };

// Mirror the report page's best-effort narrowing of the loosely-typed v2Profile
// record (schemas types it as z.record(string, unknown)). Same source the
// ArchetypeBanner announces and the same value entry.archetype selects the
// human-scorecard rubric from — so the board entry carries the real archetype,
// not a hardcoded null.
function detectArchetype(analysis: Analysis): string | null {
  const v2Profile = analysis.v2Profile as { archetype?: unknown } | null | undefined;
  return typeof v2Profile?.archetype === "string" && v2Profile.archetype ? v2Profile.archetype : null;
}

export function deriveAnalyzePipelineAffordance(analysis: Analysis | null): AnalyzePipelineAffordance | null {
  if (!analysis) return null;
  const persistence = analysis.persistence;
  // No saved row (persistence failed) → nothing to address; the candidateId the
  // board dedups on IS the analysis slug, so without it there's no honest add.
  if (!persistence?.slug) return { kind: "disabled", reason: "unsaved" };
  // No JD slug → the run wasn't tagged to a saved job. POST /api/pipeline requires
  // a jobId and the board keys its lanes by it, so a JD-less analysis has no lane
  // to file the candidate into. Honest disabled affordance, not a hidden button.
  const jdSlug = persistence.jdSlug;
  if (!jdSlug) return { kind: "disabled", reason: "jdless" };
  return {
    kind: "add",
    ref: {
      // candidateId = the saved analysis slug — the SAME identity the report page
      // passes, so re-adding from either surface hits the one idempotent entry.
      candidateId: persistence.slug,
      // Prefer the persisted label the report's on-board chip matches by; fall
      // back to the extracted name, then the slug, so the button never renders
      // an empty candidate.
      candidateLabel: persistence.candidateLabel ?? analysis.candidate?.name ?? persistence.slug,
      archetype: detectArchetype(analysis),
      // The RECONCILED total (component sum) — the same value persistAnalysis
      // stored as the row's score, so the board can't disagree with the report.
      matchScore: analysis.score ? reconcileScoreTotal(analysis.score) : null,
      roleFamily: analysis.candidate?.roleFamily ?? null,
      jobId: jdSlug,
      jobTitle: `JD ${jdSlug}`,
    },
  };
}
