import { actOnPipelineEntry, getPipelineEntry, recordAutomationEvent } from "./db";
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

  if (response === "accept") {
    markOfferResponded(token, "accepted");
    if (offer.entryId) {
      recordAutomationEvent(offer.entryId, "offer_accepted", offer.jobTitle ?? "");
      const hired = actOnPipelineEntry(offer.entryId, "accept"); // Offer -> Hired (clears approval, logs `advanced`)
      // Onboarding hook — fires on the move to Hired.
      if (hired) await dispatchOnboarding(hired);
    }
    return { ok: true, status: "accepted", alreadyResponded: false, jobTitle: offer.jobTitle, candidateLabel: offer.candidateLabel };
  }

  // decline
  markOfferResponded(token, "declined");
  if (offer.entryId) {
    markEntryStatus(offer.entryId, "rejected"); // terminal; the `offer_declined` event carries the true semantic
    recordAutomationEvent(offer.entryId, "offer_declined", offer.jobTitle ?? "");
  }
  return { ok: true, status: "declined", alreadyResponded: false, jobTitle: offer.jobTitle, candidateLabel: offer.candidateLabel };
}

/** Read an offer for the candidate-facing page (no mutation). */
export function offerView(token: string) {
  const offer = getOfferByToken(token);
  if (!offer) return null;
  const entry = offer.entryId ? getPipelineEntry(offer.entryId) : null;
  const company = entry?.jobTitle ?? null;
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
