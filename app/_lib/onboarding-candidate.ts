import { getJob, recordAutomationEvent } from "./db";
import { getRunDetail, isEntryHired, runForEntry, saveIntake, startRun } from "./onboarding-store";
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
 *  non-accepted / unlinked token, a candidate no longer live-Hired, or a revoked run
 *  (the page then shows "not available", leaking nothing).
 *
 *  The frozen `offer.status === "accepted"` is necessary but NOT sufficient: an offer
 *  accepted-then-withdrawn (un-hired / rejected / moved back) must stop provisioning.
 *  So this defers to the SAME live-stage gate the recruiter POST uses (isEntryHired)
 *  — the two hand-off gates can no longer disagree (bug-ui §candidate-onboarding #1).
 *  A run already revoked to `cancelled` never resolves and is never silently
 *  re-provisioned (bug-ui §candidate-onboarding #2). */
function runForToken(token: string) {
  const offer = getOfferByToken(token);
  if (!offer || offer.status !== "accepted" || !offer.entryId) return null;
  // Gate on the LIVE pipeline stage, not merely that an offer was once accepted.
  if (!isEntryHired(offer.entryId)) return null;
  const existing = runForEntry(offer.entryId);
  // A revoked run stays revoked — never resolve it, never re-create around it.
  if (existing && existing.status === "cancelled") return null;
  const run =
    existing ??
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
    // The questionnaire is now per-template (P1-4): the candidate sees exactly the
    // fields this hire's onboarding template defines, with their authored labels.
    fields: detail?.questionnaire ?? [],
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
  // Keep only this template's questionnaire keys (trust boundary; saveIntake also
  // bounds each value). The allowed set is the run's own template, not a global const.
  const allowed = new Set((getRunDetail(run.id)?.questionnaire ?? []).map((f) => f.key));
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(answers)) {
    if (allowed.has(k) && typeof v === "string" && v.trim()) clean[k] = v;
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
