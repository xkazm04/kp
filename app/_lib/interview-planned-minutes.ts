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
// modules where ~55 do the work. This module needs only the store reads and the
// duration constants the calculation actually reads — plus, since a job's interview
// kit sets a kit-pinned interview's length, the kit read and the pure booking rule
// (interview-kit-booking.ts), which is kept out of the agenda builder's graph for this
// reason.
//
// interview-run.ts re-exports these, so every existing import keeps working and
// there is still exactly ONE definition of each.

import { getDevCase, getSubmission } from "./db/devcase";
import type { PipelineEntry } from "./db/core";
import { getInterviewPrep } from "./interview-prep";
import { latestPublishedKit } from "./interview-kit";
import { kitBookedMin, kitSpinesAnInterview, type PrepPayload } from "./interview-kit-booking";
import { isEarlyCareer } from "./archetypes";
import { GROUNDED_DEFAULT_MIN, QUICK_SCREEN_MIN } from "./interview-duration.mjs";
import { STUDENT_SCRIPT_MIN, type CaseInterviewScenario } from "./student-interview";
import { devCaseIdForEntry, submissionIdForEntry } from "./devcase-identity";

export type SubmissionFollowup = { id?: string; decision?: string; question?: string; listenFor?: string; redFlag?: string };

/** Debrief length: ~3 min per minted question on top of the open walkthrough;
 *  capped to stay a screen. Single source for the brief AND the schedule estimate. */
export function debriefDurationMin(followupCount: number): number {
  return Math.min(25, 8 + 3 * followupCount);
}

/** The minted authorship questions on an entry's evaluated submission (empty when
 *  the entry isn't a promoted dev-case submission or nothing was minted). */
export function submissionFollowups(entry: PipelineEntry): SubmissionFollowup[] {
  const submissionId = submissionIdForEntry(entry);
  const submission = submissionId ? getSubmission(submissionId) : null;
  return ((submission?.evaluation as { followups?: { questions?: SubmissionFollowup[] } } | null)?.followups?.questions ?? []).filter(
    (f) => typeof f?.question === "string" && f.question.trim() !== ""
  );
}

/** The duration the SCHEDULING surfaces should promise for this entry (debrief >
 *  generic student > the job's kit > grounded prep > quick screen) WITHOUT its side
 *  effects: it never generates missing prep, so it is safe to call when minting a
 *  scheduling link. An entry whose prep doesn't exist yet reports the quick screen — the
 *  truthful floor — rather than a promise the brief may not keep; but a job with a
 *  published interview kit is booked at the KIT's length (interview-kit-booking.ts
 *  kitBookedMin — the same number the voice-screen mint books for this entry, with the
 *  kit version a link minted now would pin), plan or no plan. */
export function plannedInterviewMinutes(entry: PipelineEntry): number {
  const followups = submissionFollowups(entry);
  if (followups.length > 0) return debriefDurationMin(followups.length);
  if (isEarlyCareer(entry.archetype)) {
    const caseId = devCaseIdForEntry(entry);
    const scenario = caseId ? ((getDevCase(caseId)?.scenario as CaseInterviewScenario | null) ?? null) : null;
    if (scenario && Array.isArray(scenario.phases) && scenario.phases.length > 0) {
      return scenario.durationMin || STUDENT_SCRIPT_MIN;
    }
    return STUDENT_SCRIPT_MIN;
  }
  // The entry's OWN tenant: unscoped this read the default team, so on any other
  // workspace a grounded 75-minute pack reported the quick-screen floor and the
  // scheduling link was minted for the wrong length.
  const prep = (getInterviewPrep(entry.id, entry.workspaceId)?.payload as PrepPayload | undefined) ?? undefined;
  const kit = publishedKitFor(entry);
  if (kitSpinesAnInterview(kit)) return kitBookedMin(kit, prep);
  const grounded = (prep?.chronology?.length ?? 0) > 0;
  return grounded ? prep?.durationMin ?? GROUNDED_DEFAULT_MIN : QUICK_SCREEN_MIN;
}

/** The kit a voice-screen link minted for this entry NOW would pin (the job's latest
 *  published version), or null. A kit that cannot be read estimates like no kit — the
 *  mint falls back the same way — and is logged, because a round silently losing its
 *  spine is something an operator would act on. */
function publishedKitFor(entry: PipelineEntry) {
  if (!entry.jobId) return null;
  try {
    return latestPublishedKit(entry.jobId, entry.workspaceId)?.kit ?? null;
  } catch (kitErr) {
    console.error(`[interview:planned-minutes] interview kit unreadable for job ${entry.jobId}:`, kitErr);
    return null;
  }
}
