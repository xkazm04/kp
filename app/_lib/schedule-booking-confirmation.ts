// The candidate's confirmation when a RECRUITER books the interview.
//
// The candidate's own self-booking (/api/schedule/[token]) always mailed a confirmation;
// the recruiter's week-grid book (POST /api/schedule {action:"book"}) mailed nothing, so
// a candidate booked from the Schedule tab or from One learned of their interview only
// if a calendar was connected. This is the ONE place that door confirms, through the
// same letter (dispatchInterviewConfirmation) and the same send gate.
//
// The claim is the closed delivery vocabulary plus one refusal:
//   sent | queued | failed - deliveryClaim, exactly as the token route answers it.
//   withheld              - nothing was handed to the channel, by decision: the send
//                           gate refuses (consent lapsed / erased), the slate entry is an
//                           AI agent, or there is no deliverable address. Not a failure.
// The outreach opt-out halts `outreach` only (comms.ts commsSendSuppression), so it does
// not withhold this transactional letter - the same rule every candidate letter follows.
import type { PipelineEntry } from "./db/core";
import type { ScheduleInvite } from "./schedule-store";
import { markScheduleInviteNeedsReconcile } from "./schedule-store";
import { dispatchInterviewConfirmation } from "./comms-dispatch";
import { CommsSuppressedError } from "./comms";
import { entryContactability } from "./comms-contactability";
import { isDeliverableAddress, resolveCandidateRecipient } from "./comms-recipient";
import { deliveryClaim, type DeliveryClaim } from "./comms-truth";
import { isRelayConfigured } from "./comms-relay";
import { isShortNoticeBooking } from "./interview-reminder-policy";
import { pinLinkLocale } from "./candidate-link-locale";
import { resolveCommsLocale } from "./comms-locale";

export const CONFIRMATION_KIND = "interview_confirmation";

export type WithheldReason = "suppressed" | "agent" | "unaddressable";
export type BookingConfirmation =
  | { delivery: DeliveryClaim; reason: null }
  | { delivery: "withheld"; reason: WithheldReason };

/** Where a confirmation WOULD go, read before the press (One's consent card). */
export type ConfirmationForecast = {
  recipient: string | null;
  forecast: "relay" | "local" | "withheld";
  reason: WithheldReason | null;
};

type Entry = PipelineEntry & { population?: string | null };

function withheldReason(entry: Entry): WithheldReason | null {
  const v = entryContactability(entry, CONFIRMATION_KIND);
  if (v.ok) return null;
  if (v.code) return "suppressed";
  return v.reason === "agent_population" ? "agent" : "unaddressable";
}

/** Side-effect free: the recipient and what a booking's confirmation would do. */
export function bookingConfirmationForecast(entry: Entry): ConfirmationForecast {
  const reason = withheldReason(entry);
  // The resolver falls back to the label for a name-only person; only an address is named.
  const to = reason ? null : resolveCandidateRecipient(entry);
  return {
    recipient: isDeliverableAddress(to) ? to : null,
    forecast: reason ? "withheld" : isRelayConfigured() ? "relay" : "local",
    reason,
  };
}

/** Mail the candidate their confirmation for a booking the recruiter just made. Never
 *  throws: the booking already stands, so a failed letter is a claim, not an error. */
export async function confirmBookingToCandidate(
  entry: Entry,
  booked: ScheduleInvite,
  baseUrl: string
): Promise<BookingConfirmation> {
  const reason = withheldReason(entry);
  if (reason) return { delivery: "withheld", reason };
  try {
    const slotAtMs = booked.slotAt ? Date.parse(booked.slotAt) : NaN;
    const bookedAtMs = booked.confirmedAt ? Date.parse(booked.confirmedAt) : Date.now();
    const status = await dispatchInterviewConfirmation(entry, booked.slot ?? "", {
      shortNotice: !Number.isNaN(slotAtMs) && isShortNoticeBooking(slotAtMs, bookedAtMs),
      durationMin: booked.durationMin,
      slotAtIso: booked.slotAt,
      candidateTz: booked.candidateTz,
      // The candidate's way back to move it or fetch the .ics, in their own language.
      rescheduleLink: pinLinkLocale(
        `${baseUrl}/schedule/${booked.token}`,
        resolveCommsLocale(entry.locale, entry.workspaceId ?? undefined)
      ),
    });
    return { delivery: deliveryClaim(isRelayConfigured(), status), reason: null };
  } catch (err) {
    // The gate re-checks at the send: a consent that lapsed since the verdict above.
    if (err instanceof CommsSuppressedError) return { delivery: "withheld", reason: "suppressed" };
    const why = err instanceof Error ? err.message : String(err);
    console.error(`[schedule:book] confirmation for ${booked.token} failed: ${why}`);
    markScheduleInviteNeedsReconcile(booked.token, `confirmation email failed: ${why}`);
    return { delivery: "failed", reason: null };
  }
}
