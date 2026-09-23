// The application-filing core: the ONE place a door turns an applicant into a
// pipeline entry. The registry's intake golden path ("one core, many doors") puts the
// filing contract in one module; each door keeps only its validation, its knockout
// semantics, its copy and its decline mode.
//
// What the core owns, in order:
//   1. TENANT — the entry, the profile, the consent and every event share one
//      workspace (the door's override, else the opening's owning team). The profile
//      build is always handed that workspace: an omitted tenant is SILENT (the
//      builder's argument is optional and defaults to the store's default team), and
//      it is exactly how the CV door filed entry and profile into different tenants.
//   2. NAME HYGIENE — the display name is untrusted free text (a third-party form, an
//      email header, a public POST) and is cleaned once, here.
//   3. IDENTITY BEFORE BUILD — a known applicant is resolved BEFORE any profile is
//      built, so a repeat never leaves an orphan profile behind (the old CV door built
//      and saved first, then let createPipelineEntry's dedupe hand back the row).
//      The order is: the issued token's entry, else the email, else the provided name,
//      else nothing. The anonymous fallback label is a display label only and never an
//      identity: a blank name dedupes on nothing, so two nameless applicants stay two.
//   4. PROOF — what a match may do is the door's stated proof, not scattered code:
//        - "token": the applicant proved possession of the entry with the capability
//          token we emailed them (the ?lead= enrichment walk). The PROVEN MERGE:
//          fill-only contact and GitHub handle, and — when the repeat carries a CV or
//          the entry is a degraded stub — a profile REBUILD into the entry's own
//          profile id. A failed rebuild touches nothing. The only proof that rebuilds.
//        - "channel": the applicant arrived through a channel we issued (a tokened
//          webhook, our own inbound, the lead form's address match). A repeat
//          backfills a missing contact (fill-only), refreshes consent and records the
//          repeat. It never rebuilds or re-points the stored profile.
//        - "none": the match came from a typed name/email, which is not a secret.
//          Nothing on the matched entry moves; the door answers (and may re-send the
//          entry's own links to the address ON FILE — apply-link-recovery.ts).
//      The applicantKey backstop catching a concurrent first filing is this same
//      applicant by construction (its key collided while the identity lookup missed),
//      so a raced "none" writes like "channel". An ERASED applicant is never that:
//      erasure NULLs the key, and the entry id is an opaque surrogate rather than a
//      value the same address regenerates, so a re-application after erasure is a
//      new applicant, never a re-contact of the scrubbed row.
//   5. The entry at the workspace axis's ENTRY column, consent (best-effort), the
//      best-effort status-link mint, and the acknowledgement (best-effort, its links
//      minted synchronously, its dispatch deferrable off the response path).
//
// Doors: the conversational apply (app/api/apply/[id]/route.ts, "token" | "none"),
// the lead core behind the quick form and the lead webhooks (lead-intake.ts,
// "channel", a profile-less stub), the headless CV intake (cv-intake.ts,
// "channel"), and the operator's ATS import (ats/ingest.ts, "channel", a stub at
// the vendor's mapped stage, no acknowledgement). See docs/features/candidates/README.md.

import type { getJob } from "./db/jobs";
import { getJobWorkspace } from "./db/jobs";
import {
  createPipelineEntry,
  findApplicationByApplicant,
  mergeReapplication,
  recordAutomationEvent,
  recordEntryConsent,
} from "./db/pipeline";
import type { PipelineEntry } from "./db/core";
import { getPipelineAxis } from "./pipeline-axis-server";
import { stageWithRole } from "./pipeline-stages";
import { FALLBACK_ARCHETYPE } from "./apply";
import { applicantKey } from "./applicant-key";
import { ANONYMOUS_APPLICANT_LABEL, type ApplyAnswers } from "./apply-intake";
import { buildApplicantProfile, type BuildOutcome } from "./applicant-profile";
import { getOrCreateStatusLink } from "./application-status-store";
import { dispatchApplicationReceived } from "./comms-dispatch";
import { codedReasonDetail } from "./coded-reason";
import { randomId } from "./random-id";
import { sanitizeFreeText } from "./text-sanitize";
import { coerceLocale } from "@/i18n/locales";

export type FilingJob = NonNullable<ReturnType<typeof getJob>>;

/** buildApplicantProfile's shape — injectable so the core is testable without Python. */
export type ProfileBuilder = typeof buildApplicantProfile;

export type FilingProof = "token" | "channel" | "none";

/** Which acknowledgement is being sent: the first one, or the re-ack of a repeat whose
 *  entry only NOW became reachable (its first ack had nowhere to go). */
export type AckKind = "ack" | "reack";

/** "token" names the entry the token resolved to; the other proofs carry none. */
type ProofInput =
  | { proof: "token"; tokenEntry: PipelineEntry }
  | { proof: "channel" | "none"; tokenEntry?: undefined };

export type ApplicationFilingInput = ProofInput & {
  job: FilingJob;
  /** The team the applicant is filed into; defaults to the opening's owning team. */
  workspaceId?: string;
  /** Raw, untrusted display name. "" files under the anonymous label, never deduped. */
  name: string;
  email: string | null;
  locale: string | null;
  /** Attribution stored on the entry and on the consent record. */
  sourceChannel: string;
  /** Event prose for the audit trail ("inbound CV", "conversational apply"). */
  channelLabel: string;
  /** E5 campaign/creative attribution, already bounded by the door. */
  sourceCampaign?: string | null;
  sourceVariant?: string | null;
  /** Self-reported GitHub handle, already shape-gated by the door. Fill-only on a merge. */
  githubHandle?: string | null;
  /** Stored job title override (the sim's `(SIM)` marker); defaults to the job's own. */
  jobTitle?: string;
  /** The column a FRESH filing lands on; defaults to the workspace axis's entry column.
   *  A door that names one owns the check that it is a live, non-terminal column of
   *  that axis (the ATS import maps the vendor's stage — app/_lib/ats/ingest.ts). A
   *  repeat never moves: this is where a new entry starts, not a stage change. */
  stage?: string;
  /** The door's intake answers, minus the name the core sanitizes itself. */
  answers?: Omit<ApplyAnswers, "name">;
  /** File a profile-less, intake-degraded STUB instead of building (the lead form: a
   *  reachable address and nothing to build from yet). `reason` is the recruiter-facing
   *  story of why the entry is thin; `idPrefix` names the label-only candidate id. */
  stub?: { idPrefix: string; reason: string };
  /** Default buildApplicantProfile. Always called WITH the tenant and the locale. */
  buildProfile?: ProfileBuilder;
  /** Send the "application received" ack. Default true. */
  sendAck?: boolean;
  /** Schedule the ack off the response path; omitted = inline await. */
  defer?: (task: () => Promise<void>, kind: AckKind) => void;
  /** Door bookkeeping on an entry the filing writes to (a fresh one, or a repeat the
   *  proof lets write), run before consent and the ack — the lead door mints its
   *  enrichment token here so the ack can carry it. Never called for proof "none". */
  onEntry?: (entry: PipelineEntry) => void;
  /** The ABSOLUTE status link the ack carries. Minted synchronously, before deferral,
   *  so the email and the door's response share one token. */
  statusLinkFor?: (entry: PipelineEntry) => string | null;
  /** The ABSOLUTE enrichment link the ack carries, per ack kind. */
  enrichLinkFor?: (entry: PipelineEntry, kind: AckKind) => string | null;
  /** The `re_applied` event detail. Default: the coded repeatApplication* reason. */
  repeatDetail?: (changes: string[]) => string;
};

export type ApplicationFilingOutcome =
  | {
      kind: "created";
      entry: PipelineEntry;
      label: string;
      /** The profile build; null for a stub filing, which builds nothing. */
      built: BuildOutcome | null;
    }
  | {
      kind: "duplicate";
      entry: PipelineEntry;
      label: string;
      /** True when the repeat was allowed to write (token or channel proof, or a race). */
      merged: boolean;
      /** The applicantKey backstop caught a concurrent first filing. */
      raced: boolean;
      /** What the merge folded onto the entry, for the event trail. */
      changes: string[];
      /** The proven merge's profile rebuild, when one ran (proof "token" only). */
      rebuilt: BuildOutcome | null;
    };

// Best-effort: the consent bookkeeping must never undo a filed application.
function recordConsentSafely(entryId: string, source: string, workspaceId: string): void {
  try {
    recordEntryConsent(entryId, source, undefined, workspaceId);
  } catch (err) {
    console.error(`[application-filing] consent record failed for entry ${entryId}:`, err instanceof Error ? err.message : err);
  }
}

/** Mint (or reuse) an entry's status-link token (idea-e76a6fb2), best-effort: the
 *  application already succeeded, so a status-link failure must never turn it into an
 *  error — the candidate just doesn't get the tracking link. The ONE copy every door
 *  uses (getOrCreateStatusLink is keyed on the entry, so repeated calls agree). */
export function safeStatusToken(entryId: string): string | null {
  try {
    return getOrCreateStatusLink(entryId);
  } catch (err) {
    console.error(`[application-filing] could not mint status link for entry ${entryId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function fileApplication(input: ApplicationFilingInput): Promise<ApplicationFilingOutcome> {
  const { job } = input;
  // 1. Tenant — threaded into every write below.
  const workspaceId = input.workspaceId ?? getJobWorkspace(job.id);
  // 2. Name hygiene. The provided name is the identity; the fallback is a label.
  const providedName = sanitizeFreeText(input.name);
  const label = providedName || ANONYMOUS_APPLICANT_LABEL;
  const email = input.email?.trim() || null;
  const locale = coerceLocale(input.locale) ?? undefined;
  const githubHandle = input.githubHandle || null;
  const answers: ApplyAnswers = { skills: "", ...input.answers, name: label };
  const build = input.buildProfile ?? buildApplicantProfile;

  const ack = async (entry: PipelineEntry, links: { enrichLink?: string; statusLink?: string }) => {
    try {
      await dispatchApplicationReceived(entry, links);
    } catch (err) {
      console.error(`[application-filing] acknowledgement failed for entry ${entry.id}:`, err instanceof Error ? err.message : err);
    }
  };
  // The one ack seam, so the first ack and the newly-reachable re-ack cannot drift.
  // The links are minted HERE, synchronously, before any deferral: the response and
  // the email must carry the same token.
  const sendAck = async (entry: PipelineEntry, kind: AckKind) => {
    if (input.sendAck === false) return;
    let links: { enrichLink?: string; statusLink?: string } = {};
    try {
      const statusLink = input.statusLinkFor?.(entry) ?? null;
      const enrichLink = input.enrichLinkFor?.(entry, kind) ?? null;
      links = { ...(enrichLink ? { enrichLink } : undefined), ...(statusLink ? { statusLink } : undefined) };
    } catch (err) {
      console.error(`[application-filing] ack links failed for entry ${entry.id}:`, err instanceof Error ? err.message : err);
    }
    if (input.defer) input.defer(() => ack(entry, links), kind);
    else await ack(entry, links);
  };

  // 4. A repeat under the door's proof.
  const repeat = async (existing: PipelineEntry, raced: boolean): Promise<ApplicationFilingOutcome> => {
    const proof: FilingProof = raced && input.proof === "none" ? "channel" : input.proof;
    if (proof === "none") {
      return { kind: "duplicate", entry: existing, label, merged: false, raced, changes: [], rebuilt: null };
    }
    input.onEntry?.(existing);
    const changes: string[] = [];
    const updates: { contact?: string; candidateId?: string; archetype?: string | null; githubHandle?: string } = {};
    if (email && !existing.contact) {
      updates.contact = email;
      changes.push("contact email captured");
    }
    if (githubHandle && !existing.githubHandle) {
      updates.githubHandle = githubHandle;
      changes.push("GitHub handle captured");
    }
    // The PROVEN merge alone may rebuild: a CV-carrying repeat, or any repeat onto a
    // degraded stub, rebuilds INTO the entry's own profile id (in place for a healthy
    // original, a fresh save + re-point for the stub). A failed rebuild moves nothing.
    let rebuilt: BuildOutcome | null = null;
    if (proof === "token" && (answers.cvText || existing.intakeDegraded)) {
      rebuilt = await build(job, answers, existing.candidateId, workspaceId, locale);
      if (rebuilt.ok) {
        updates.candidateId = rebuilt.id;
        updates.archetype = rebuilt.archetype;
        changes.push(existing.intakeDegraded ? "degraded intake recovered (profile rebuilt)" : "profile rebuilt with CV");
      }
    }
    let entry = existing;
    if (changes.length > 0) {
      const merged = mergeReapplication(existing.id, updates, workspaceId);
      if (merged) {
        entry = merged;
        // Newly reachable: the first acknowledgement had nowhere to go.
        if (updates.contact) await sendAck(merged, "reack");
      }
    }
    // Re-applying re-consents: refresh the data-processing consent + expiry.
    recordConsentSafely(entry.id, input.sourceChannel, workspaceId);
    recordAutomationEvent(
      entry.id,
      "re_applied",
      input.repeatDetail
        ? input.repeatDetail(changes)
        : codedReasonDetail(changes.length ? "repeatApplicationContact" : "repeatApplication", { channel: input.channelLabel }),
      workspaceId
    );
    return { kind: "duplicate", entry, label, merged: true, raced, changes, rebuilt };
  };

  // 3. Identity BEFORE build: the token's entry, else findApplicationByApplicant (the
  //    email, else the provided name; nothing for an anonymous, address-less applicant).
  const existing = input.proof === "token" ? input.tokenEntry : findApplicationByApplicant(job.id, providedName, email, workspaceId);
  if (existing) return repeat(existing, false);

  let built: BuildOutcome | null = null;
  let candidateId: string;
  let degraded: { reason: string } | null;
  if (input.stub) {
    candidateId = randomId(input.stub.idPrefix);
    degraded = { reason: input.stub.reason };
  } else {
    built = await build(job, answers, null, workspaceId, locale);
    candidateId = built.ok ? built.id : randomId("apply");
    degraded = built.ok ? null : { reason: built.reason };
  }

  const { entry, created } = createPipelineEntry({
    candidateId,
    candidateLabel: label,
    // A degraded intake, a stub, or a build with no archetype is stamped UNCLASSIFIED —
    // never a guessed archetype, and never a concrete class that would strip the
    // fail-closed fairness shield. See FALLBACK_ARCHETYPE.
    archetype: (built?.ok ? built.archetype : null) ?? FALLBACK_ARCHETYPE,
    roleFamily: job.roleFamily ?? null,
    jobId: job.id,
    jobTitle: input.jobTitle ?? job.title,
    // A fresh application arrives at the board's ENTRY column, whatever this
    // workspace calls it — not at a stage that happens to be named "Accepted" (the
    // axis is editable; a hardcoded name strands applicants off-axis).
    stage: input.stage ?? stageWithRole("entry", getPipelineAxis(workspaceId).stages) ?? "Accepted",
    // Keyed on the email, else the PROVIDED name, as a hashed, erasable identity: ""
    // (anonymous) never dedupes, so anonymous applicants stay apart. The entry id is an
    // opaque surrogate either way. Backstops two concurrent first filings that both
    // missed the lookup.
    applicantKey: applicantKey(providedName, email),
    intakeDegraded: degraded !== null,
    intakeDegradedReason: degraded?.reason ?? null,
    contact: email,
    githubHandle,
    locale: input.locale,
    sourceChannel: input.sourceChannel,
    sourceCampaign: input.sourceCampaign ?? null,
    sourceVariant: input.sourceVariant ?? null,
    workspaceId,
  });
  if (!created) return repeat(entry, true);

  input.onEntry?.(entry);
  // GDPR: data-processing consent + a 12-month expiry at intake (the expiry drives
  // the anonymization sweep). Best-effort — never undoes a filed application.
  recordConsentSafely(entry.id, input.sourceChannel, workspaceId);
  await sendAck(entry, "ack");
  return { kind: "created", entry, label, built };
}
