import { actOnPipelineEntry, getJob, recordAutomationEvent } from "./db";
import { dispatchOnboarding } from "./comms-dispatch";
import { recordAudit } from "./dev-control";
import { recordPipelineOutcome } from "./dev-outcomes";
import { expireOfferIfDue, getOfferByToken, markEntryStatus, markOfferResponded } from "./offers-store";

// Direction #4 — capture the candidate's offer response and run the terminal
// transitions. The offer DECISION was the recruiter's (extend); here we record
// what the candidate decided. Idempotent: a second response is a no-op that just
// returns the recorded status.

export type OfferResponseResult =
  | { ok: true; status: "accepted" | "declined"; alreadyResponded: boolean; jobTitle: string | null; candidateLabel: string | null }
  | { ok: false; error: string; expired?: boolean };

export async function respondToOffer(token: string, response: "accept" | "decline"): Promise<OfferResponseResult> {
  // Lapse first (idea-29361408): an offer past its deadline must not be acceptable
  // even if the candidate is holding a stale tab — the deadline is the lever.
  const offer = expireOfferIfDue(token);
  if (!offer) return { ok: false, error: "Offer not found." };

  // Past its deadline — the link is dead. Reported distinctly so the route can
  // 410 and the page can show an "expired" state instead of mislabeling it declined.
  if (offer.status === "expired") {
    return { ok: false, error: "This offer has expired.", expired: true };
  }

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
      // W5-2 (DEVO2) — a hired "ds-" (promoted-submission) entry auto-feeds the
      // dev-case calibration loop. Best-effort: calibration must never affect
      // the candidate's accept. (The CAS winner above is the sole caller, so
      // this can't double-fire; recordPipelineOutcome is also ref-idempotent.)
      if (hired) {
        try {
          if (recordPipelineOutcome(hired, "hired")) {
            recordAudit({
              actor: "system",
              action: "outcome_auto_recorded",
              reason: `${hired.candidateLabel}: hired (predicted ${hired.matchScore ?? "—"})`,
            });
          }
        } catch (err) {
          console.error("[offer] outcome auto-record failed", err);
        }
      }
      // Onboarding hook — fires on the move to Hired. The accept already committed (offer
      // accepted + entry Hired), and a retry early-returns "accepted" — so a comms blip here
      // must NOT 500 (that masks the gap as success) or leave zero signal. Mirror the schedule
      // confirm flow: catch the dispatch failure, record a durable operator-visible reconcile
      // event so onboarding can be re-triggered, and still return ok.
      if (hired) {
        try {
          await dispatchOnboarding(hired);
        } catch (err) {
          recordAutomationEvent(
            offer.entryId,
            "onboarding_failed",
            err instanceof Error ? err.message.slice(0, 160) : "onboarding dispatch failed"
          );
          console.error(
            `[offer] accepted + Hired but onboarding dispatch failed for entry ${offer.entryId}:`,
            err instanceof Error ? err.message : err
          );
        }
      }
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
    // CONDITIONAL: tokens never expire and an entry can hold several offer links,
    // so a decline on a STALE/duplicate link must not demote a candidate who has
    // since been Hired or otherwise closed out — markEntryStatus guards that and
    // reports whether the entry actually transitioned. Only stamp the decline on
    // the entry's timeline when it did, so a Hired candidate's history can't grow a
    // phantom `offer_declined` (recordAutomationEvent logs the entry's CURRENT stage).
    const transitioned = markEntryStatus(offer.entryId, "declined");
    if (transitioned) recordAutomationEvent(offer.entryId, "offer_declined", offer.jobTitle ?? "");
  }
  return { ok: true, status: "declined", alreadyResponded: false, jobTitle: offer.jobTitle, candidateLabel: offer.candidateLabel };
}

/** Read an offer for the candidate-facing page. Lapses it first if the deadline
 *  has passed (idea-29361408), so the page renders 'expired' the moment it's due
 *  rather than waiting on the heartbeat sweep. */
export function offerView(token: string) {
  const offer = expireOfferIfDue(token);
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
    expiresAt: offer.expiresAt,
  };
}
