import { getJob, recordAutomationEvent } from "./db";
import { ENTRY_QUESTIONNAIRE_FIELDS } from "./onboarding";
import { getRunDetail, runForEntry, saveIntake, startRun } from "./onboarding-store";
import { getOfferByToken } from "./offers-store";

// Candidate-facing onboarding bridge (offers #5). The recruiter-side onboarding feature
// (#6) already owns the run/checklist/intake/e-sign per Hired candidate, but it was
// recruiter-only: an accepted candidate had no way to fill the PRE-BOARDING questionnaire
// their hire record wants, so accept dead-ended at "our People team will be in touch".
//
// This bridges the candidate's existing secure credential — the accepted offer's token —
// to that onboarding run, exposing exactly the questionnaire fields (never the recruiter
// checklist actions or offer terms). It ensures a run exists (idempotent startRun) so the
// link works even for a hire the recruiter hasn't opened yet.

/** Resolve the accepted-offer token to the candidate's onboarding run. Null for any
 *  non-accepted / unlinked token (the page then shows "not available", leaking nothing). */
function runForToken(token: string) {
  const offer = getOfferByToken(token);
  if (!offer || offer.status !== "accepted" || !offer.entryId) return null;
  const run =
    runForEntry(offer.entryId) ??
    startRun({ entryId: offer.entryId, candidateLabel: offer.candidateLabel, jobTitle: offer.jobTitle });
  return { offer, run };
}

/** The candidate-facing onboarding view: welcome identity + the pre-boarding questionnaire
 *  (fields + any answers already saved) + a read-only progress reassurance from the
 *  recruiter checklist. No checklist actions, no offer terms. */
export function candidateOnboardingView(token: string) {
  const resolved = runForToken(token);
  if (!resolved) return null;
  const { offer, run } = resolved;
  const detail = getRunDetail(run.id);
  const job = offer.jobId ? getJob(offer.jobId) : null;
  return {
    role: offer.jobTitle,
    candidateLabel: offer.candidateLabel,
    company: job?.company ?? null,
    fields: ENTRY_QUESTIONNAIRE_FIELDS,
    answers: detail?.intake ?? {},
    submitted: Boolean(detail?.intake),
    progressPct: detail?.progress.pct ?? 0,
  };
}

/** Persist the candidate's pre-boarding answers against their onboarding run (offers #5).
 *  Only the known questionnaire fields are kept (trust boundary; saveIntake also bounds
 *  each value); a timeline event mirrors it to the recruiter so the People team sees the
 *  candidate engaged. No-op (ok:false) on a non-accepted token. */
export function submitCandidateIntake(token: string, answers: Record<string, unknown>): { ok: boolean } {
  const resolved = runForToken(token);
  if (!resolved) return { ok: false };
  const { offer, run } = resolved;
  const clean: Record<string, string> = {};
  for (const field of ENTRY_QUESTIONNAIRE_FIELDS) {
    const v = answers[field];
    if (typeof v === "string" && v.trim()) clean[field] = v;
  }
  saveIntake(run.id, clean);
  if (offer.entryId) {
    try {
      recordAutomationEvent(offer.entryId, "onboarding_intake_submitted", offer.jobTitle ?? "");
    } catch (e) {
      console.error("[onboarding] intake saved but timeline event failed", e);
    }
  }
  return { ok: true };
}
