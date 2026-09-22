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
//     link (E4 speed-to-lead), tokened with the entry's opaque lead token so the
//     follow-up opens prefilled and the W8-6 merge machinery targets this same
//     entry directly (the same-address re-type is now only the fallback).
// Callers keep what differs per surface: input validation, the KO verdict
// semantics (strict for our own form, provided-only for third-party payloads),
// and the localized human-facing response copy.

import type { JobRecord } from "./db/core";
import { getJobWorkspace } from "./db/jobs";
import { ensureLeadEnrichToken, recordKnockoutDecline } from "./db/pipeline";
import { fileApplication } from "./application-filing";
import { dispatchKnockoutDecline } from "./comms-dispatch";
import { sanitizeFreeText } from "./text-sanitize";
import { codedReasonDetail } from "./coded-reason";

const STUB_REASON_MAX = 280;

export type LeadIntakeInput = {
  job: JobRecord;
  /** The team the applicant is filed into. Defaults to the JOB's owning team (a public
   *  applicant has no session); the webhook receiver overrides with its own workspace. */
  workspaceId?: string;
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
  /** KO ids the lead EXPLICITLY answered true under the caller's verdict —
   *  recorded on the entry so the enrichment chat skips exactly those gates and
   *  no others (an unrecorded gate is asked again, never assumed). */
  passedKoIds?: string[];
  /** KO ids the source couldn't verify (webhook forms that didn't ask) — recorded
   *  on the stub for recruiter visibility, never a reason to discard. */
  ungatedKoIds?: string[];
  /** ABSOLUTE link to the conversational apply (the enrichment path). */
  enrichLink: string;
  /** Mint (or reuse) the candidate's ABSOLUTE status-tracking link for an entry
   *  (capst-l1-002): the conversational path has always put this in both the ack
   *  and its done screen, while a quick-apply lead got neither. Provided by the
   *  route (which owns the request origin + token store); best-effort — null
   *  simply omits the status line, never blocks the intake. */
  statusLinkFor?: (entryId: string) => string | null;
  /** Schedule the acknowledgement OFF the response path. The ack is an SMTP/relay
   *  round-trip that is already best-effort (its failure is logged and never
   *  changes the intake outcome), so making the applicant wait on it only turns a
   *  slow provider into a slow — or apparently broken — apply form for a lead that
   *  has already been filed. A route handler passes next/server's post-response
   *  hook (see afterResponse in after-response.ts).
   *
   *  OMITTED = the historical inline await, deliberately: this module is also
   *  driven from surfaces with no request context, and a caller that hasn't opted
   *  in keeps byte-identical ordering. Only the dispatch's TIMING moves — every
   *  dispatch still happens, including the "newly reachable" re-ack below. */
  defer?: (task: () => Promise<void>) => void;
  /** Webhook surfaces pass true so a KO-declined lead is TOLD the outcome — their
   *  only touchpoint said "submitted" on a third-party board. The own quick-apply
   *  form keeps this false: it shows the decline live in the UI (no double message). */
  notifyDecline?: boolean;
};

export type LeadIntakeOutcome =
  | { result: "declined" }
  | {
      result: "accepted";
      duplicate: boolean;
      entryId: string;
      /** The entry's opaque enrichment token (ensureLeadEnrichToken) — already
       *  appended to the emailed enrich link; returned so the caller's success
       *  screen can carry the SAME identity on its own CTA. Null only when the
       *  entry vanished mid-intake (the link then degrades to first-time flow). */
      leadToken: string | null;
    };

// Append the entry's lead token to the enrichment link, so the conversational
// apply opens knowing WHO is enriching (prefill + targeted merge) instead of
// greeting the lead as a stranger. The base link already carries ?lang=, hence
// the separator check; a null token leaves the link bare (still valid).
function withLeadToken(link: string, token: string | null): string {
  return token ? `${link}${link.includes("?") ? "&" : "?"}lead=${encodeURIComponent(token)}` : link;
}

export async function intakeLead(input: LeadIntakeInput): Promise<LeadIntakeOutcome> {
  const { job } = input;
  // Tenant (P1): file into the opening's owning team (public applicant, no session); the
  // webhook receiver passes its own workspace to override. Threaded into every entry-keyed
  // call below (dedup, token, merge, consent, events) so the whole intake stays team-scoped.
  const workspaceId = input.workspaceId ?? getJobWorkspace(job.id);
  // Untrusted free text, cleaned ONCE at the core rather than at each door: the name
  // and the attribution values arrive from a third-party form we do not control, and
  // they are rendered to a recruiter, stored into `intakeDegradedReason` (prose a later
  // prompt reads back) and used as analytics group keys. sanitizeFreeText strips markup
  // and every invisible/control code point; the length caps stay where they were.
  const name = sanitizeFreeText(input.name);
  const email = input.email.trim();
  const sourceCampaign = input.sourceCampaign ? sanitizeFreeText(input.sourceCampaign) || null : null;
  const sourceVariant = input.sourceVariant ? sanitizeFreeText(input.sourceVariant) || null : null;

  // Knockout gate — audited, entry-less (see recordKnockoutDecline).
  if (input.failedKoIds.length > 0) {
    recordKnockoutDecline({
      candidateLabel: name || null,
      jobTitle: job.title,
      channel: input.channelLabel,
      failedKoIds: input.failedKoIds,
      // Same tenant the accepted path files into — a declined applicant is counted
      // (and their name shown) only by the team that owns the opening.
      workspaceId,
    });
    // The adverse outcome is where the never-ghost promise matters most — and the
    // email is in hand. Best-effort like the ack: a comms failure never changes
    // the intake verdict, and the outbox row makes the decline auditable.
    if (input.notifyDecline && email) {
      try {
        // Same tenant the decline RECORD above was filed into: the notice is entry-less
        // (no entry exists yet), so without this its outbox row lands in the DEFAULT
        // team's Comms Center — invisible to the team that owns the opening.
        await dispatchKnockoutDecline({
          email,
          name: name || null,
          jobTitle: job.title,
          locale: input.locale,
          workspaceId,
        });
      } catch (declineErr) {
        console.error(
          `[lead-intake] KO decline recorded but notification failed for ${email}:`,
          declineErr instanceof Error ? declineErr.message : declineErr
        );
      }
    }
    return { result: "declined" };
  }

  // The stub reason is the recruiter-visible story of WHY this entry is thin —
  // including which eligibility gates the source form never asked (E3: ungated
  // is visible, not silent).
  // CODED (`pipeline.intakeReasons.*`), so the banner and the row tooltip render it in
  // the reader's language. Two codes rather than one with an optional param: next-intl
  // wants every placeholder present, and "which gates the source never asked" is a
  // different sentence, not a blank. The ungated ids are OUR ids (derived from the job's
  // KO steps), never payload text. The cap is a last-resort guard on the ENCODED string:
  // a cut token would simply fail to parse, so it degrades to the paramless code.
  const ungated = input.ungatedKoIds?.length ? input.ungatedKoIds.join(", ") : "";
  let stubReason = ungated
    ? codedReasonDetail("leadPendingUngated", { channel: input.channelLabel, ungated })
    : codedReasonDetail("leadPending", { channel: input.channelLabel });
  if (stubReason.length > STUB_REASON_MAX) {
    stubReason = codedReasonDetail("leadPending", { channel: input.channelLabel });
  }

  // The FILING is the shared core's (application-filing.ts): tenant, identity before
  // anything is written, the entry column, consent, the ack seam and its deferral.
  // This door supplies its proof and its lead-specific halves:
  //   - proof "channel": the lead arrived through a form or webhook we issued, so a
  //     repeat (identity = the email, findApplicationByApplicant) backfills the
  //     original entry's contact and re-acks if it just became reachable — never a
  //     profile rebuild;
  //   - a profile-less STUB: a passing lead files intake-degraded (an UNCLASSIFIED
  //     archetype, the stub reason above), carrying contact, locale and E5 attribution;
  //   - the entry's opaque lead token, minted (fill-only) on every entry the filing
  //     writes to — fresh, repeat, or the dedupe backstop's race — and refreshing the
  //     recorded KO pass-state, since this submission just re-verified those gates;
  //   - E4 speed-to-lead: the ack carries the enrichment link tokened with that lead
  //     token, so the follow-up opens prefilled AND merges back onto this exact entry.
  //     A newly-reachable repeat gets it only while the entry is still a stub needing
  //     it (a healthy entry needs no enrichment invitation); the status link (when the
  //     caller can mint one) rides on EVERY ack.
  let leadToken: string | null = null;
  const outcome = await fileApplication({
    job,
    workspaceId,
    name,
    email,
    locale: input.locale,
    sourceChannel: input.sourceChannel,
    sourceCampaign,
    sourceVariant,
    channelLabel: input.channelLabel,
    proof: "channel",
    stub: { idPrefix: "lead", reason: stubReason },
    defer: input.defer,
    onEntry: (entry) => {
      leadToken = ensureLeadEnrichToken(entry.id, input.passedKoIds, workspaceId);
    },
    enrichLinkFor: (entry, kind) => (kind === "reack" && !entry.intakeDegraded ? null : withLeadToken(input.enrichLink, leadToken)),
    statusLinkFor: input.statusLinkFor ? (entry) => input.statusLinkFor?.(entry.id) ?? null : undefined,
  });
  return { result: "accepted", duplicate: outcome.kind === "duplicate", entryId: outcome.entry.id, leadToken };
}
