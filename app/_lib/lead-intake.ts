// E2/E3 (Erika gap) — the shared lead-intake core behind every minimal-field
// inbound surface: the quick-apply form and the channel webhooks. One place
// owns the contract so the channels can't drift:
//   - a KO fail is AUDITED (entry-less ko_declined event), never a silent
//     discard, and never a terminal row a mis-tap couldn't retry past;
//   - identity is the email (findApplicationByApplicant), a repeat backfills
//     the original entry's contact and re-acks if it just became reachable;
//   - a passing lead files at Accepted as an intake-degraded stub carrying
//     contact, locale, and source-channel attribution (E5's axis);
//   - the acknowledgement goes out immediately with the full-apply enrichment
//     link (E4 speed-to-lead) — re-applying with the same address rebuilds the
//     profile onto this same entry via the existing W8-6 merge machinery.
// Callers keep what differs per surface: input validation, the KO verdict
// semantics (strict for our own form, provided-only for third-party payloads),
// and the localized human-facing response copy.

import type { JobRecord } from "./db";
import {
  createPipelineEntry,
  findApplicationByApplicant,
  mergeReapplication,
  recordAutomationEvent,
  recordKnockoutDecline,
} from "./db";
import { applyDedupeKey, FALLBACK_ARCHETYPE } from "./apply";
import { dispatchApplicationReceived, dispatchKnockoutDecline } from "./comms-dispatch";
import { randomId } from "./random-id";

const STUB_REASON_MAX = 280;

export type LeadIntakeInput = {
  job: JobRecord;
  /** Display name; "" files as the anonymous "Applicant" label (no name-dedup). */
  name: string;
  /** Required — already validated by the caller; the lead form's point is reachability. */
  email: string;
  locale: string | null;
  /** Attribution stored on the entry ('quick-apply' | 'email' | 'boards'). */
  sourceChannel: string;
  /** E5 — campaign/creative attribution (already bounded by the caller). */
  sourceCampaign?: string | null;
  sourceVariant?: string | null;
  /** Event prose for the audit trail ("quick apply", "boards webhook"). */
  channelLabel: string;
  /** KO ids that FAILED under the caller's verdict semantics — any present ⇒ decline. */
  failedKoIds: string[];
  /** KO ids the source couldn't verify (webhook forms that didn't ask) — recorded
   *  on the stub for recruiter visibility, never a reason to discard. */
  ungatedKoIds?: string[];
  /** ABSOLUTE link to the conversational apply (the enrichment path). */
  enrichLink: string;
  /** Webhook surfaces pass true so a KO-declined lead is TOLD the outcome — their
   *  only touchpoint said "submitted" on a third-party board. The own quick-apply
   *  form keeps this false: it shows the decline live in the UI (no double message). */
  notifyDecline?: boolean;
};

export type LeadIntakeOutcome =
  | { result: "declined" }
  | { result: "accepted"; duplicate: boolean; entryId: string };

export async function intakeLead(input: LeadIntakeInput): Promise<LeadIntakeOutcome> {
  const { job } = input;
  const name = input.name.trim();
  const email = input.email.trim();

  // Knockout gate — audited, entry-less (see recordKnockoutDecline).
  if (input.failedKoIds.length > 0) {
    recordKnockoutDecline({
      candidateLabel: name || null,
      jobTitle: job.title,
      channel: input.channelLabel,
      failedKoIds: input.failedKoIds,
    });
    // The adverse outcome is where the never-ghost promise matters most — and the
    // email is in hand. Best-effort like the ack: a comms failure never changes
    // the intake verdict, and the outbox row makes the decline auditable.
    if (input.notifyDecline && email) {
      try {
        await dispatchKnockoutDecline({ email, name: name || null, jobTitle: job.title, locale: input.locale });
      } catch (declineErr) {
        console.error(
          `[lead-intake] KO decline recorded but notification failed for ${email}:`,
          declineErr instanceof Error ? declineErr.message : declineErr
        );
      }
    }
    return { result: "declined" };
  }

  const ack = async (entry: Parameters<typeof dispatchApplicationReceived>[0], withEnrich: boolean) => {
    try {
      await dispatchApplicationReceived(entry, withEnrich ? { enrichLink: input.enrichLink } : undefined);
    } catch (ackErr) {
      console.error(
        `[lead-intake] lead accepted but acknowledgement failed for entry ${entry.id}:`,
        ackErr instanceof Error ? ackErr.message : ackErr
      );
    }
  };

  // Duplicate policy — same identity rules as the conversational flow. A repeat
  // backfills a missing contact onto the original entry; a newly-reachable entry
  // gets the ack its first application couldn't deliver (with the enrichment
  // link when it's still a stub needing one).
  const existing = findApplicationByApplicant(job.id, name, email);
  if (existing) {
    const changes: string[] = [];
    if (!existing.contact) {
      const merged = mergeReapplication(existing.id, { contact: email });
      changes.push("contact email captured");
      if (merged) await ack(merged, merged.intakeDegraded);
    }
    recordAutomationEvent(
      existing.id,
      "re_applied",
      changes.length
        ? `repeat application via ${input.channelLabel} — ${changes.join("; ")}`
        : `repeat application via ${input.channelLabel}`
    );
    return { result: "accepted", duplicate: true, entryId: existing.id };
  }

  // The stub reason is the recruiter-visible story of WHY this entry is thin —
  // including which eligibility gates the source form never asked (E3: ungated
  // is visible, not silent). English-canonical like every degraded reason.
  let stubReason = `${input.channelLabel} lead — profile pending enrichment (full-apply link sent in the acknowledgement)`;
  if (input.ungatedKoIds?.length) {
    stubReason += `; eligibility not verified by the source form: ${input.ungatedKoIds.join(", ")}`;
  }
  if (stubReason.length > STUB_REASON_MAX) stubReason = `${stubReason.slice(0, STUB_REASON_MAX - 1)}…`;

  const { entry, created } = createPipelineEntry({
    candidateId: randomId("lead"),
    candidateLabel: name || "Applicant",
    // Never guess a fairness-shielded archetype for a thin lead — the
    // enrichment re-apply recovers the real one alongside the profile.
    archetype: FALLBACK_ARCHETYPE,
    roleFamily: job.roleFamily ?? null,
    jobId: job.id,
    jobTitle: job.title,
    stage: "Accepted",
    dedupeKey: applyDedupeKey(name, email),
    intakeDegraded: true,
    intakeDegradedReason: stubReason,
    contact: email,
    locale: input.locale,
    sourceChannel: input.sourceChannel,
    sourceCampaign: input.sourceCampaign ?? null,
    sourceVariant: input.sourceVariant ?? null,
  });

  // The dedupeKey backstop caught a concurrent repeat — surface it as one.
  if (!created) {
    recordAutomationEvent(entry.id, "re_applied", `repeat application via ${input.channelLabel}`);
    return { result: "accepted", duplicate: true, entryId: entry.id };
  }

  // E4 — speed-to-lead: the ack (with the enrichment link) fires the moment the
  // lead lands. Best-effort: a comms failure must never undo a filed application.
  await ack(entry, true);
  return { result: "accepted", duplicate: false, entryId: entry.id };
}
