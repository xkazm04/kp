import type { PipelineEntry } from "./db/core";
import { latestInterviewByEntry } from "./db/interviews";
import { interviewLetterByEntry, interviewLetterDecidingEvent, interviewLetterRequest, type InterviewLetterRecord } from "./db/interview-letters";
import { getPipelineAxis } from "./pipeline-axis-server";
import { roleOf } from "./pipeline-stages";
import { candidateStatusFor } from "./application-status";
import { resolveCommsLocale } from "./comms-locale";
import { consentWithholdsPii } from "./consent";
import { candidateLetterView, EMPTY_LETTER_VIEW, letterEligibility, type LetterEligibility } from "./interview-letter-policy";
import type { CandidateLetterView } from "./interview-letter-types";
import { isLocale, type Locale } from "@/i18n/locales";

// The DB-reading half of the interview feedback letter's door (spark
// interview-feedback-letter, WP-alpha): it reads the facts off the record and hands them
// to the pure rule in interview-letter-policy.ts. Deliberately free of the task runner —
// the public status GET imports this module on every poll, and the task hub is a large
// graph that only the request POST needs (it starts the draft itself).

function consentOf(entry: PipelineEntry) {
  return { givenAt: entry.consentGivenAt, expiresAt: entry.consentExpiresAt, anonymizedAt: entry.anonymizedAt };
}

/** Whether a recorded interview scorecard exists for this application. The letter is
 *  ABOUT the AI interview; with nothing on record there is nothing it could report. The
 *  same session read the rejection and offer letters use (latestInterviewByEntry prefers a
 *  transcript-bearing session). */
export function entryHasInterviewRecord(entryId: string, workspaceId: string): boolean {
  const scorecard = latestInterviewByEntry(entryId, workspaceId)?.scorecard;
  return !!scorecard && typeof scorecard === "object";
}

/** Eligibility for one entry, read from the record. `workspaceId` is the ENTRY's own
 *  (the caller derived it with getEntryWorkspace, or holds the entry's team). */
export function interviewLetterEligibilityFor(entry: PipelineEntry, workspaceId: string, nowMs: number = Date.now()): LetterEligibility {
  // "Hired" exactly as the candidate's own status page reads it: the stage's ROLE on this
  // workspace's axis (candidateStatusFor + roleOf, the status route's resolution), never
  // the literal stage name, which a renamed column would silently miss. One projection,
  // so the page can never say "hired" while the letter rule disagrees.
  const atTerminalStage = candidateStatusFor(entry.status, entry.stage, roleOf(entry.stage, getPipelineAxis(workspaceId).stages)) === "hired";
  return letterEligibility(
    {
      entryStatus: entry.status,
      atTerminalStage,
      // Only a rejected entry has a deciding event to attribute; reading it for any other
      // status would be a wasted query on every status poll.
      decidingEvent: entry.status === "rejected" ? interviewLetterDecidingEvent(entry.id, workspaceId) : null,
      consent: consentOf(entry),
      // Lazy: read only once the decision itself qualifies (see the policy's input type).
      hasInterviewRecord: () => entryHasInterviewRecord(entry.id, workspaceId),
    },
    nowMs
  );
}

/** Once a letter exists, eligibility no longer decides anything the candidate sees — the
 *  letter's own state does (one request per application). This stands in for it. */
const LETTER_EXISTS: LetterEligibility = { eligible: false, reason: "no_decision" };

/** What the candidate's status page is told about their letter — the contract's
 *  CandidateLetterView and nothing else. */
export function candidateLetterViewFor(entry: PipelineEntry, workspaceId: string, nowMs: number = Date.now()): CandidateLetterView {
  const consent = consentOf(entry);
  // Consent withheld: the page is told nothing, and nothing else is read.
  if (consentWithholdsPii(consent, nowMs)) return { ...EMPTY_LETTER_VIEW };
  const letter = interviewLetterByEntry(entry.id, workspaceId);
  // A letter that exists is shown by its own state; eligibility is only computed when
  // there is still a button to decide on (and only then are its reads paid for).
  const eligibility = letter ? LETTER_EXISTS : interviewLetterEligibilityFor(entry, workspaceId, nowMs);
  return candidateLetterView(letter, eligibility, consent, nowMs);
}

/** The language the letter is written in, resolved ONCE at request time: the language the
 *  candidate's own status page was showing when they asked (their explicit choice, sent
 *  by the page), else the entry's comms locale — the one authority for "which language
 *  does this candidate hear from us in" (comms-locale.ts). */
export function letterLanguage(requested: unknown, entry: PipelineEntry, workspaceId: string): Locale {
  return isLocale(requested) ? requested : resolveCommsLocale(entry.locale, workspaceId);
}

export type LetterRequestOutcome =
  | { kind: "not_eligible" }
  | { kind: "exists"; letter: InterviewLetterRecord; view: CandidateLetterView }
  | { kind: "created"; letter: InterviewLetterRecord; view: CandidateLetterView };

/**
 * Record a candidate's request, or say why not. Order is the contract the door relies on:
 *
 *   1. consent withheld → not eligible (and the view says nothing — see the policy);
 *   2. a letter already exists → that letter, untouched (idempotent — one per application);
 *   3. not eligible → refused;
 *   4. otherwise insert. The insert itself is idempotent too (unique key), so two racing
 *      requests that both passed step 2 still produce ONE letter, and the loser is told
 *      `exists` rather than `created`.
 *
 * It does NOT start the draft: the caller queues the task only on `created`, so a
 * repeated click never queues a second draft.
 */
export function requestInterviewLetter(entry: PipelineEntry, workspaceId: string, lang: Locale, nowMs: number = Date.now()): LetterRequestOutcome {
  const consent = consentOf(entry);
  if (consentWithholdsPii(consent, nowMs)) return { kind: "not_eligible" };
  const existing = interviewLetterByEntry(entry.id, workspaceId);
  if (existing) return { kind: "exists", letter: existing, view: candidateLetterView(existing, LETTER_EXISTS, consent, nowMs) };
  const eligibility = interviewLetterEligibilityFor(entry, workspaceId, nowMs);
  if (!eligibility.eligible) return { kind: "not_eligible" };
  const { letter, created } = interviewLetterRequest({ entryId: entry.id, lang, outcome: eligibility.outcome }, workspaceId);
  const view = candidateLetterView(letter, LETTER_EXISTS, consent, nowMs);
  return created ? { kind: "created", letter, view } : { kind: "exists", letter, view };
}
