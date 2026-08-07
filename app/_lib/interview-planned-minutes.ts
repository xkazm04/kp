// How long an interview is PLANNED to run — the single estimate the scheduling
// surfaces mint links with, extracted out of interview-run.ts as a leaf.
//
// WHY IT LIVES ALONE. `plannedInterviewMinutes` is the only thing the three
// /api/schedule* routes want from the interview subsystem, but importing it from
// interview-run.ts dragged that module's whole graph — the voice layer, the prep
// generator, the transcript/scorecard pipeline, the automation runner — into
// routes that only mint a scheduling link. `next dev` compiles a route's entire
// module graph with no tree-shaking (see "Dev compile cost" in
// docs/architecture/app-structure.md), so the estimate cost /api/schedule 116
// modules where ~55 do the work. This module needs only the two store reads and
// the duration constants the calculation actually reads.
//
// interview-run.ts re-exports these, so every existing import keeps working and
// there is still exactly ONE definition of each.

import { getDevCase, getSubmission } from "./db/devcase";
import type { PipelineEntry } from "./db/core";
import { getInterviewPrep } from "./interview-prep";
import { isEarlyCareer } from "./archetypes";
import { GROUNDED_DEFAULT_MIN, QUICK_SCREEN_MIN } from "./interview-duration.mjs";
import { devCaseIdFromJobId, STUDENT_SCRIPT_MIN, submissionIdFromCandidateId, type CaseInterviewScenario } from "./student-interview";

export type SubmissionFollowup = { id?: string; decision?: string; question?: string; listenFor?: string; redFlag?: string };

/** Debrief length: ~3 min per minted question on top of the open walkthrough;
 *  capped to stay a screen. Single source for the brief AND the schedule estimate. */
export function debriefDurationMin(followupCount: number): number {
  return Math.min(25, 8 + 3 * followupCount);
}

/** The minted authorship questions on an entry's evaluated submission (empty when
 *  the entry isn't a promoted dev-case submission or nothing was minted). */
export function submissionFollowups(entry: PipelineEntry): SubmissionFollowup[] {
  const submissionId = submissionIdFromCandidateId(entry.candidateId);
  const submission = submissionId ? getSubmission(submissionId) : null;
  return ((submission?.evaluation as { followups?: { questions?: SubmissionFollowup[] } } | null)?.followups?.questions ?? []).filter(
    (f) => typeof f?.question === "string" && f.question.trim() !== ""
  );
}

/** Minimal shape of the stored prep payload this estimate reads. The full
 *  PrepPayload (with the brief's chronology/imported questions) stays in
 *  interview-run.ts, which is the module that composes briefs. */
type PrepDurationPayload = { durationMin?: number; chronology?: unknown[] };

/** The duration the SCHEDULING surfaces should promise for this entry (debrief >
 *  generic student > grounded prep > quick screen) WITHOUT its side effects: it
 *  never generates missing prep, so it is safe to call when minting a scheduling
 *  link. An entry whose prep doesn't exist yet reports the quick screen — the
 *  truthful floor — rather than a promise the brief may not keep. */
export function plannedInterviewMinutes(entry: PipelineEntry): number {
  const followups = submissionFollowups(entry);
  if (followups.length > 0) return debriefDurationMin(followups.length);
  if (isEarlyCareer(entry.archetype)) {
    const caseId = devCaseIdFromJobId(entry.jobId);
    const scenario = caseId ? ((getDevCase(caseId)?.scenario as CaseInterviewScenario | null) ?? null) : null;
    if (scenario && Array.isArray(scenario.phases) && scenario.phases.length > 0) {
      return scenario.durationMin || STUDENT_SCRIPT_MIN;
    }
    return STUDENT_SCRIPT_MIN;
  }
  const prep = (getInterviewPrep(entry.id)?.payload as PrepDurationPayload | undefined) ?? undefined;
  const grounded = (prep?.chronology?.length ?? 0) > 0;
  return grounded ? prep?.durationMin ?? GROUNDED_DEFAULT_MIN : QUICK_SCREEN_MIN;
}
