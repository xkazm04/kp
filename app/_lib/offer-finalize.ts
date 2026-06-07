import { actOnPipelineEntry, getJob, recordAutomationEvent } from "./db";
import { dispatchOnboarding } from "./comms-dispatch";
import { getOfferByToken, markEntryStatus, markOfferResponded } from "./offers-store";

// Direction #4 — capture the candidate's offer response and run the terminal
// transitions. The offer DECISION was the recruiter's (extend); here we record
// what the candidate decided. Idempotent: a second response is a no-op that just
// returns the recorded status.

export type OfferResponseResult =
  | { ok: true; status: "accepted" | "declined"; alreadyResponded: boolean; jobTitle: string | null; candidateLabel: string | null }
  | { ok: false; error: string };

export async function respondToOffer(token: string, response: "accept" | "decline"): Promise<OfferResponseResult> {
  const offer = getOfferByToken(token);
  if (!offer) return { ok: false, error: "Offer not found." };

  // Already answered — idempotent (candidate refreshed, or recruiter + candidate both clicked).
  if (offer.status !== "extended") {
    return {
      ok: true,
      status: offer.status === "accepted" ? "accepted" : "declined",
      alreadyResponded: true,
      jobTitle: offer.jobTitle,
      candidateLabel: offer.candidateLabel,
    };
  }

  // The CAS in markOfferResponded is the ONLY claim that counts (idea-e80f60f1):
  // the status read above is a snapshot, and two concurrent responses (candidate
  // double-click; candidate + recruiter-on-behalf) both pass it. Previously the
  // result was ignored and BOTH callers ran the terminal side effects — double
  // onboarding dispatch, phantom Hired transitions, duplicate automation events.
  // Now the loser reports the recorded outcome and touches nothing.
  if (response === "accept") {
    const { offer: claimedOffer, claimed } = markOfferResponded(token, "accepted");
    if (!claimed) {
      // The CAS lost — someone else recorded the response first. Report the
      // AUTHORITATIVE recorded status, re-reading the offer if markOfferResponded
      // couldn't return it, so a null offer never defaults an accepter to "declined".
      const recorded = claimedOffer ?? getOfferByToken(token);
      const status = recorded?.status === "accepted" ? "accepted" : "declined";
      return { ok: true, status, alreadyResponded: true, jobTitle: offer.jobTitle, candidateLabel: offer.candidateLabel };
    }
    if (offer.entryId) {
      recordAutomationEvent(offer.entryId, "offer_accepted", offer.jobTitle ?? "");
      const hired = actOnPipelineEntry(offer.entryId, "accept"); // Offer -> Hired (clears approval, logs `advanced`)
      // Onboarding hook — fires on the move to Hired.
      if (hired) await dispatchOnboarding(hired);
    }
    return { ok: true, status: "accepted", alreadyResponded: false, jobTitle: offer.jobTitle, candidateLabel: offer.candidateLabel };
  }

  // decline
  const { offer: claimedOffer, claimed } = markOfferResponded(token, "declined");
  if (!claimed) {
    const recorded = claimedOffer ?? getOfferByToken(token);
    const status = recorded?.status === "accepted" ? "accepted" : "declined";
    return { ok: true, status, alreadyResponded: true, jobTitle: offer.jobTitle, candidateLabel: offer.candidateLabel };
  }
  if (offer.entryId) {
    // Terminal `declined` — the candidate turned us down. Distinct from the
    // recruiter's `rejected` so funnel/re-engagement reporting can tell a
    // candidate-side close from a company-side one (see pipeline-status.ts).
    markEntryStatus(offer.entryId, "declined");
    recordAutomationEvent(offer.entryId, "offer_declined", offer.jobTitle ?? "");
  }
  return { ok: true, status: "declined", alreadyResponded: false, jobTitle: offer.jobTitle, candidateLabel: offer.candidateLabel };
}

/** Read an offer for the candidate-facing page (no mutation). */
export function offerView(token: string) {
  const offer = getOfferByToken(token);
  if (!offer) return null;
  // The hiring company lives on the job record (not the pipeline entry), so resolve
  // it from there — this is what lets the public offer page show who it's from.
  const job = offer.jobId ? getJob(offer.jobId) : null;
  const company = job?.company ?? null;
  return {
    token: offer.token,
    status: offer.status,
    jobTitle: offer.jobTitle,
    candidateLabel: offer.candidateLabel,
    currency: offer.currency,
    salary: offer.salary,
    company,
  };
}
