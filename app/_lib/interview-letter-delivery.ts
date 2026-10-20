import type { PipelineEntry } from "./db/core";
import { interviewLetterRecordDelivery, type InterviewLetterRecord } from "./db/interview-letters";
import { dispatchInterviewLetter } from "./comms-dispatch";
import { CommsSuppressedError } from "./comms";
import { getOrCreateStatusLink } from "./application-status-store";
import { resolveCommsLocale } from "./comms-locale";
import { consentWithholdsPii } from "./consent";
import type { OutboxStatus } from "./comms-status";
import type { LetterDelivery } from "./interview-letter-types";

// Delivery of an APPROVED interview feedback letter (spark interview-feedback-letter,
// WP-beta). Split from the review queue so the queue GET never compiles the send path.
//
// TRUTHFUL, in the comms layer's own vocabulary (comms-status.ts): `sent` only when a
// relay accepted it, `queued` when there is no relay and the outbox row IS the
// destination, `failed` when it did not go out. The letter row records exactly what the
// outbox reported, never "the call resolved".
//
// A SUPPRESSED SEND. The channel's consent gate (comms.ts commsSendSuppression) refuses
// to write to a person whose consent lapsed or who was anonymized — resolved at the
// durable CANDIDATE identity, so another application of the same person can close the
// channel even while this application's own consent stands. Nothing leaves the building,
// so the letter's delivery is recorded as `failed` (the contract's vocabulary has no
// fourth word, and `queued` would claim an outbox row that does not exist) and the
// caller is told `suppressed: true` so the recruiter reads why. The approval itself
// stands: a person approved the text, and the candidate's own status page shows it
// whenever THEIR consent allows (the page's read-time gate, interview-letter-policy.ts
// candidateLetterView) — `readableOnStatusPage` says which.

export type LetterDeliveryOutcome = {
  delivery: LetterDelivery;
  /** The channel's consent gate refused the send; `delivery` is then `failed`. */
  suppressed: boolean;
  /** Whether the candidate's own status page shows the approved letter (their consent
   *  allows it). The email and the page are two channels, and one can be closed while
   *  the other is open. */
  readableOnStatusPage: boolean;
  /** False when the delivery could not be written back onto the letter (the row moved:
   *  an erasure closed it between the approve and the send). */
  recorded: boolean;
};

/** The outbox status, in the letter contract's three words. `bounced` is a later receipt,
 *  never a send result; were one ever handed back here, it is not a delivery. */
export function letterDeliveryFor(status: OutboxStatus): LetterDelivery {
  if (status === "sent") return "sent";
  if (status === "queued") return "queued";
  return "failed";
}

/** The status-link token the email carries, or null (the line is then omitted, never a
 *  dead link). The mint is idempotent — the candidate who asked from their page gets the
 *  SAME link back. */
function statusTokenFor(entryId: string): string | null {
  try {
    return getOrCreateStatusLink(entryId);
  } catch (err) {
    // The letter still goes out; only the "read it on your page" line is lost. Logged,
    // because an operator should know the status-link store refused.
    console.error(`[interview-letter] could not mint the status link for entry ${entryId}`, err);
    return null;
  }
}

/** Send an approved letter and record what happened on the letter. Never throws: the
 *  approval is already on the record, and a delivery fault is an outcome to report, not
 *  a reason to tell the recruiter their approval failed. */
export async function deliverApprovedLetter(
  letter: InterviewLetterRecord,
  entry: PipelineEntry,
  workspaceId: string
): Promise<LetterDeliveryOutcome> {
  let delivery: LetterDelivery = "failed";
  let suppressed = false;
  try {
    const status = await dispatchInterviewLetter(entry, {
      text: letter.finalText ?? "",
      locale: resolveCommsLocale(letter.lang, workspaceId),
      statusToken: statusTokenFor(entry.id),
    });
    delivery = letterDeliveryFor(status);
  } catch (err) {
    if (err instanceof CommsSuppressedError) {
      suppressed = true;
      console.warn(`[interview-letter] letter ${letter.id} not emailed: the consent gate refused (${err.reason})`);
    } else {
      console.error(`[interview-letter] letter ${letter.id} could not be dispatched`, err);
    }
  }
  let recorded = false;
  try {
    recorded = interviewLetterRecordDelivery(letter.id, delivery, workspaceId) !== null;
  } catch (err) {
    console.error(`[interview-letter] could not record delivery "${delivery}" on letter ${letter.id}`, err);
  }
  const consent = { givenAt: entry.consentGivenAt, expiresAt: entry.consentExpiresAt, anonymizedAt: entry.anonymizedAt };
  return { delivery, suppressed, readableOnStatusPage: !consentWithholdsPii(consent), recorded };
}
