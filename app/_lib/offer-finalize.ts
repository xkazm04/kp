import type { RefusalErrorCode } from "./api-response";
import { getJob } from "./db/jobs";
import { actOnPipelineEntry, getPipelineEntry, recordAutomationEvent } from "./db/pipeline";
import { getPipelineAxis } from "./pipeline-axis-server";
import { stageHasRole } from "./pipeline-stages";
import { dispatchAtsEvent } from "./ats-egress";
import { recordAudit } from "./dev-control";
import { recordMeterUsage } from "./billing";
import { recordPipelineOutcome } from "./dev-outcomes";
import { expireOfferIfDue, getOfferByToken, markEntryStatus, markOfferResponded, type OfferRow } from "./offers-store";
import { offerHoursRemaining } from "./offer-policy";

// Direction #4 — capture the candidate's offer response and run the terminal
// transitions. The offer DECISION was the recruiter's (extend); here we record
// what the candidate decided. Idempotent: a second response is a no-op that just
// returns the recorded status.

export type OfferResponseResult =
  | { ok: true; status: "accepted" | "declined"; alreadyResponded: boolean; jobTitle: string | null; candidateLabel: string | null }
  // A refusal carries its CODE, not a sentence: the candidate page localizes it
  // (REFUSAL_ERRORS in api-response.ts). `expired` stays because the route needs
  // it to choose 410-vs-404, which is a different question from what to say.
  | { ok: false; code: RefusalErrorCode; expired?: boolean };

export async function respondToOffer(token: string, response: "accept" | "decline"): Promise<OfferResponseResult> {
  // Lapse first (idea-29361408): an offer past its deadline must not be acceptable
  // even if the candidate is holding a stale tab — the deadline is the lever.
  const offer = expireOfferIfDue(token);
  if (!offer) return { ok: false, code: "OFFER_NOT_FOUND" };

  // Past its deadline — the link is dead. Reported distinctly so the route can
  // 410 and the page can show an "expired" state instead of mislabeling it declined.
  if (offer.status === "expired") {
    return { ok: false, code: "OFFER_EXPIRED", expired: true };
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
  // result was ignored and BOTH callers ran the terminal side effects — phantom
  // Hired transitions, duplicate automation events, a doubled ATS hire webhook.
  // Now the loser reports the recorded outcome and touches nothing.
  //
  // The CAS-loser path is identical for both responses: report the AUTHORITATIVE
  // recorded status, re-reading the offer if markOfferResponded couldn't return it,
  // so a null offer never defaults an accepter to "declined".
  //
  // Losing the CAS does NOT imply someone answered: the row can also have gone
  // 'expired' between the lapse check above and the claim (the heartbeat sweep, or
  // another tab's GET lazily lapsing it on a deadline that fell in between). Reporting
  // that as `status: "declined"` told a candidate who pressed Accept that they had
  // turned the job down. Anything that isn't a recorded accept/decline is the same
  // refusal the non-racing path returns.
  const reportLoser = (claimedOffer: OfferRow | null): OfferResponseResult => {
    const recorded = claimedOffer ?? getOfferByToken(token);
    const status = recorded?.status === "accepted" ? "accepted" : recorded?.status === "declined" ? "declined" : null;
    if (!status) {
      return recorded ? { ok: false, code: "OFFER_EXPIRED", expired: true } : { ok: false, code: "OFFER_NOT_FOUND" };
    }
    return { ok: true, status, alreadyResponded: true, jobTitle: offer.jobTitle, candidateLabel: offer.candidateLabel };
  };

  if (response === "accept") {
    const { offer: claimedOffer, claimed } = markOfferResponded(token, "accepted");
    if (!claimed) return reportLoser(claimedOffer);
    if (offer.entryId) {
      // The stage the entry stood on BEFORE the response — read first because
      // `accept` advances ONE stage along THIS WORKSPACE's axis and never reports
      // whether that landed on the hire. See `hired` below.
      const before = getPipelineEntry(offer.entryId, offer.workspaceId);
      // Offer -> Hired (clears approval). actor "system": the transition fires on
      // the candidate's response, not a recruiter click — logs `auto_advanced`.
      // actOnPipelineEntry now refuses to advance a TERMINAL entry, so a stale
      // offer link accepted after the candidate was rejected/closed elsewhere
      // returns null instead of resurrecting them to Hired.
      const advanced = actOnPipelineEntry(offer.entryId, "accept", undefined, { actor: "system" }, offer.workspaceId);
      // A non-null return means "the entry moved a stage", NOT "this candidate is
      // hired" — two different questions, and the hire-bearing side effects below
      // (the hire meter, the outcome ground truth, the candidate.hired webhook into
      // the customer's HRIS) may only answer the second one:
      //   - a workspace may compose a column AFTER its offer step (a background
      //     check, a contract signature); accept lands there, not on the hire, and
      //     these effects would fire for someone who is not hired;
      //   - a recruiter may move a candidate BACK off Offer while the link is live
      //     (setPipelineEntryStage) — the same wrong answer;
      //   - a candidate already on the terminal stage who accepts a SECOND link
      //     (a re-extend mints a fresh token once the first is answered) hits
      //     actOnPipelineEntry's "already terminal, no-op" branch, which still
      //     returns the entry — the CAS in markOfferResponded is per-TOKEN, so it
      //     cannot dedupe that; the hire would be metered and mirrored twice.
      // Resolved by ROLE off the workspace's own board, never by the stage's name.
      const axis = getPipelineAxis(offer.workspaceId).stages;
      const wasTerminal = !!before && stageHasRole(before.stage, "terminal", axis);
      const hired = advanced && !wasTerminal && stageHasRole(advanced.stage, "terminal", axis) ? advanced : null;
      // Only stamp the accept on the timeline when it actually advanced (mirrors the
      // decline path's conditional event), so a closed entry can't grow a phantom
      // offer_accepted; record the conflict instead so a recruiter can see it.
      if (advanced) {
        recordAutomationEvent(offer.entryId, "offer_accepted", offer.jobTitle ?? "", offer.workspaceId);
      } else {
        recordAutomationEvent(offer.entryId, "offer_accept_blocked", "accepted on a closed entry — not advanced to Hired", offer.workspaceId);
      }
      if (hired) {
        // THE HIRE METER — the headline unit of an outcome-priced product, debited
        // here because this is the only place a candidate can reach the terminal
        // stage (a manual move to it is refused in pipeline-entry-action.ts).
        // Fires exactly once per hire: markOfferResponded is a DB compare-and-swap
        // so only the first responder on a token gets `claimed` (double-click, link
        // opened twice), and `hired` above requires the entry to have CROSSED onto
        // the terminal stage, so a second token accepted on an already-hired entry
        // debits nothing.
        //
        // DEBITED, NEVER GATED. There is no meterGate before it and there must not
        // be: this runs on the CANDIDATE's accept, and a person accepting a job must
        // never fail because the recruiter's org is over its allowance. Overage is
        // billed and surfaced in Billing; it is never a reason to break the moment
        // the whole product exists to produce. Best-effort for the same reason — a
        // metering fault must not turn a successful acceptance into an error.
        try {
          recordMeterUsage("hires", 1, new Date(), offer.workspaceId);
        } catch (meterErr) {
          console.error(
            `[offer] hired ${offer.entryId} but the hire meter did not record:`,
            meterErr instanceof Error ? meterErr.message : meterErr
          );
        }
      }
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
      // Hired is the TERMINAL state kp owns. What happens after the hire — pre-boarding
      // paperwork, equipment, day one — is deliberately out of scope: this is a hiring
      // studio, and the post-hire hand-off belongs to the HRIS the webhook below feeds.
      if (hired) {
        // P1-5 — mirror the hire into any configured ATS/HRIS webhook so the
        // system of record gets the outcome without re-keying (Marcus #12).
        // Fire-and-forget + self-contained best-effort: a no-op unless a webhook
        // and the candidate.hired event are configured, and it can never break the
        // accept (dispatchAtsEvent swallows its own errors).
        void dispatchAtsEvent("candidate.hired", hired.id);
      }
    }
    return { ok: true, status: "accepted", alreadyResponded: false, jobTitle: offer.jobTitle, candidateLabel: offer.candidateLabel };
  }

  // decline
  const { offer: claimedOffer, claimed } = markOfferResponded(token, "declined");
  if (!claimed) return reportLoser(claimedOffer);
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
    const transitioned = markEntryStatus(offer.entryId, "declined", offer.workspaceId);
    if (transitioned) recordAutomationEvent(offer.entryId, "offer_declined", offer.jobTitle ?? "", offer.workspaceId);
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
    // Countdown computed on the SERVER clock (offers-onboarding #5) so the candidate's
    // "X hours left" copy can't drift from server-enforced expiry under client clock skew.
    hoursRemaining: offerHoursRemaining(offer.expiresAt),
  };
}

