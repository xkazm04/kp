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
//      email header) and is cleaned once, here.
//   3. IDENTITY BEFORE BUILD — a known applicant is resolved BEFORE any profile is
//      built, so a repeat never leaves an orphan profile behind (the old CV door built
//      and saved first, then let createPipelineEntry's dedupe hand back the row).
//      The anonymous fallback label is a display label only and never an identity:
//      a blank name dedupes on nothing, so two nameless applicants stay two.
//   4. PROOF — what a match may do is the door's stated proof, not scattered code:
//        - "channel": the applicant arrived through a channel we issued (a tokened
//          webhook, our own inbound). A repeat backfills a missing contact
//          (fill-only), refreshes consent and records the repeat. It never rebuilds
//          or re-points the stored profile.
//        - "none": the match came from a typed name/email, which is not a secret.
//          Nothing on the matched entry moves.
//   5. The entry at the workspace axis's ENTRY column, consent (best-effort), and
//      the acknowledgement (best-effort, deferrable off the response path).
//
// Migrated doors: the headless CV intake (cv-intake.ts). The conversational route
// and the lead core (lead-intake.ts) still file on their own; see
// docs/features/candidates/README.md for the migration note.

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
import { applyDedupeKey, FALLBACK_ARCHETYPE } from "./apply";
import { ANONYMOUS_APPLICANT_LABEL, type ApplyAnswers } from "./apply-intake";
import { buildApplicantProfile, type BuildOutcome } from "./applicant-profile";
import { dispatchApplicationReceived } from "./comms-dispatch";
import { codedReasonDetail } from "./coded-reason";
import { randomId } from "./random-id";
import { sanitizeFreeText } from "./text-sanitize";
import { coerceLocale } from "@/i18n/locales";

export type FilingJob = NonNullable<ReturnType<typeof getJob>>;

/** buildApplicantProfile's shape — injectable so the core is testable without Python. */
export type ProfileBuilder = typeof buildApplicantProfile;

export type FilingProof = "channel" | "none";

export type ApplicationFilingInput = {
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
  /** Stored job title override (the sim's `(SIM)` marker); defaults to the job's own. */
  jobTitle?: string;
  /** The door's intake answers, minus the name the core sanitizes itself. */
  answers: Omit<ApplyAnswers, "name">;
  proof: FilingProof;
  /** Default buildApplicantProfile. Always called WITH the tenant and the locale. */
  buildProfile?: ProfileBuilder;
  /** Send the "application received" ack. Default true. */
  sendAck?: boolean;
  /** Schedule the ack off the response path; omitted = inline await. */
  defer?: (task: () => Promise<void>) => void;
};

export type ApplicationFilingOutcome =
  | { kind: "created"; entry: PipelineEntry; label: string; built: BuildOutcome }
  | {
      kind: "duplicate";
      entry: PipelineEntry;
      label: string;
      /** True when the repeat was allowed to write (channel proof). */
      merged: boolean;
      /** What the merge folded onto the entry, for the event trail. */
      changes: string[];
    };

// Best-effort: the consent bookkeeping must never undo a filed application.
function recordConsentSafely(entryId: string, source: string, workspaceId: string): void {
  try {
    recordEntryConsent(entryId, source, undefined, workspaceId);
  } catch (err) {
    console.error(`[application-filing] consent record failed for entry ${entryId}:`, err instanceof Error ? err.message : err);
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

  const ack = async (entry: PipelineEntry) => {
    try {
      await dispatchApplicationReceived(entry);
    } catch (err) {
      console.error(`[application-filing] acknowledgement failed for entry ${entry.id}:`, err instanceof Error ? err.message : err);
    }
  };
  const sendAck = async (entry: PipelineEntry) => {
    if (input.sendAck === false) return;
    if (input.defer) input.defer(() => ack(entry));
    else await ack(entry);
  };

  // A repeat under the door's proof. `raced` is the dedupeKey backstop catching a
  // concurrent first filing, which is this same applicant by construction.
  const repeat = async (existing: PipelineEntry): Promise<ApplicationFilingOutcome> => {
    if (input.proof === "none") {
      return { kind: "duplicate", entry: existing, label, merged: false, changes: [] };
    }
    const changes: string[] = [];
    let entry = existing;
    if (email && !existing.contact) {
      const merged = mergeReapplication(existing.id, { contact: email }, workspaceId);
      if (merged) {
        entry = merged;
        changes.push("contact email captured");
        // Newly reachable: the first acknowledgement had nowhere to go.
        await sendAck(merged);
      }
    }
    recordConsentSafely(entry.id, input.sourceChannel, workspaceId);
    recordAutomationEvent(
      entry.id,
      "re_applied",
      codedReasonDetail(changes.length ? "repeatApplicationContact" : "repeatApplication", { channel: input.channelLabel }),
      workspaceId
    );
    return { kind: "duplicate", entry, label, merged: true, changes };
  };

  // 3. Identity BEFORE build. findApplicationByApplicant keys on the email, else the
  //    provided name, and returns nothing for an anonymous, address-less applicant.
  const existing = findApplicationByApplicant(job.id, providedName, email, workspaceId);
  if (existing) return repeat(existing);

  const build = input.buildProfile ?? buildApplicantProfile;
  const built = await build(job, { ...input.answers, name: label }, null, workspaceId, locale);
  const candidateId = built.ok ? built.id : randomId("apply");

  const { entry, created } = createPipelineEntry({
    candidateId,
    candidateLabel: label,
    // A degraded intake (or a build with no archetype) is stamped UNCLASSIFIED —
    // never a guessed archetype. See FALLBACK_ARCHETYPE.
    archetype: (built.ok ? built.archetype : null) ?? FALLBACK_ARCHETYPE,
    roleFamily: job.roleFamily ?? null,
    jobId: job.id,
    jobTitle: input.jobTitle ?? job.title,
    // A fresh application arrives at the board's ENTRY column, whatever this
    // workspace calls it — not at a stage that happens to be named "Accepted".
    stage: stageWithRole("entry", getPipelineAxis(workspaceId).stages) ?? "Accepted",
    // Keyed on the PROVIDED name (and the email first): "" yields no key, so the
    // entry id falls back to the fresh candidate id and anonymous applicants stay apart.
    dedupeKey: applyDedupeKey(providedName, email),
    intakeDegraded: !built.ok,
    intakeDegradedReason: built.ok ? null : built.reason,
    contact: email,
    locale: input.locale,
    sourceChannel: input.sourceChannel,
    workspaceId,
  });
  if (!created) return repeat(entry);

  recordConsentSafely(entry.id, input.sourceChannel, workspaceId);
  await sendAck(entry);
  return { kind: "created", entry, label, built };
}
