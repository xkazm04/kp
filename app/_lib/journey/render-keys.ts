// kind -> catalog key. The ONLY place a journey row's sentence is decided.
//
// The projection never stores prose (see types.ts). The board asks this module
// which catalog key a row renders through, and next-intl resolves it in the
// reader's language with the row's own `facts` as ICU arguments.
//
// Adding a kind here means adding `journey.events.<key>` to all four catalogs in
// the same change — `npm run i18n:check` enforces the parity, and next-intl keys
// are typed, so a missing one is a `tsc` error rather than a runtime blank.

import type { JourneyEvent } from "./types";

/**
 * Kinds this module knows how to say. Keys are the event `kind` exactly as the
 * source ledger writes it — never a prettified variant, so a grep for a kind
 * finds both the writer and the renderer.
 */
const EVENT_KEYS: Record<string, string> = {
  // ---- pipeline_events (app/_lib/db/core.ts:601, written via recordEvent)
  added: "added",
  applied: "applied",
  matched: "matched",
  advanced: "advanced",
  auto_advanced: "autoAdvanced",
  moved: "moved",
  screening_hold: "screeningHold",
  schedule_invite_sent: "scheduleInviteSent",
  scheduled: "scheduled",
  interview_scheduled: "interviewScheduled",
  interview_reminder_sent: "interviewReminderSent",
  interview_prep_generated: "interviewPrepGenerated",
  rejection_sent: "rejectionSent",
  rejected: "rejected",
  auto_rejected: "autoRejected",
  acknowledgement_sent: "acknowledgementSent",
  offer_drafted: "offerDrafted",
  offer_sent: "offerSent",
  offer_reminder_sent: "offerReminderSent",
  reinstated: "reinstated",
  ko_declined: "koDeclined",
  approval_set: "approvalSet",

  // ---- analyses (joined by label + jd_slug; may carry confidence "label-only")
  analysis: "analysis",

  // ---- interview_sessions / interview_events
  interview_session: "interviewSession",
  interview_round: "interviewRound",
  topic_begun: "topicBegun",
  topic_covered: "topicCovered",
  candidate_question: "candidateQuestion",
  guardrail: "guardrail",
  focus_lost: "focusLost",

  // ---- decision_records (the sealed, hash-chained chain)
  decision_sealed: "decisionSealed",

  // ---- consent_events
  consent_recorded: "consentRecorded",

  // ---- dev_* (case phase)
  case_designed: "caseDesigned",
  case_approved: "caseApproved",
  case_published: "casePublished",
  case_opened: "caseOpened",
  case_submitted: "caseSubmitted",
  case_evaluated: "caseEvaluated",

  // ---- intake_events (the one new writer in this design)
  intake_round: "intakeRound",
  intake_brief_changed: "intakeBriefChanged",
  intake_promoted: "intakePromoted",
};

/** Rows whose sentence is the TOPIC rather than the kind. */
const TOPIC_DRIVEN = new Set(["intake_round", "interview_round"]);

/**
 * The catalog key for one row, as a dotted path under `journey.`.
 *
 * A conversational round renders through its topic when it has one, so the board
 * can say "Candidate asked about salary" rather than "an interview round
 * happened". A round the classifier could not place falls back to its kind —
 * a legitimate outcome, never an error.
 *
 * An unknown kind falls back to `journey.events.unknown`, which renders the raw
 * kind as an argument. A new source kind therefore degrades to something honest
 * and visibly unstyled instead of rendering blank.
 */
export function journeyEventMessageKey(
  event: Pick<JourneyEvent, "kind" | "topicCode"> & { facts?: JourneyEvent["facts"] }
): string {
  if (TOPIC_DRIVEN.has(event.kind) && event.topicCode) {
    return `topics.${event.topicCode}`;
  }
  // `analyses.score` is nullable, and the absent-value convention omits the fact
  // rather than inventing a number. `events.analysis` hard-requires {score}, so an
  // unscored analysis needs its own message instead of an unfilled ICU argument.
  if (event.kind === "analysis" && (event.facts?.score ?? null) === null) {
    return "events.analysisUnscored";
  }
  const key = EVENT_KEYS[event.kind];
  return key ? `events.${key}` : "events.unknown";
}

/** Every kind this module maps, so a test can build one row per message. */
export function allJourneyKinds(): string[] {
  return Object.keys(EVENT_KEYS);
}

/** True when this module can say something specific about the kind. */
export function isKnownJourneyKind(kind: string): boolean {
  return Object.hasOwn(EVENT_KEYS, kind);
}

/** Every catalog key this module can emit — used by the catalog-coverage test. */
export function allJourneyMessageKeys(): string[] {
  return [
    ...new Set(Object.values(EVENT_KEYS).map((k) => `events.${k}`)),
    "events.analysisUnscored",
    "events.unknown",
  ];
}
