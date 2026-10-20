// Who may ask for an interview FEEDBACK LETTER, and what the candidate's own status page
// is told about one (spark interview-feedback-letter, WP-alpha). The contract is
// app/_lib/interview-letter-types.ts; this is the rule that decides it.
//
// PURE and import-light (consent.ts and the contract) so every rule
// here is unit-pinned with literals, and the DB-reading composition
// (interview-letter.ts) is a thin wrapper that feeds it facts off the record.
//
// THE RULE, stated once. A letter may be requested only after a PERSON decided about this
// candidate:
//   * HIRED — the stage's role is the board's terminal one and the entry is still live
//     (candidateStatusFor's own `hired`). Always a decision about this person.
//   * NOT SELECTED by a human — the entry is `rejected` AND the event that rejected it
//     names a human actor. An automated screen-out (`auto_rejected`, the screen wave's
//     own kind) is NOT eligible even when a named person approved the batch: the batch
//     approval is a decision about a COHORT, and nothing was decided about this one
//     candidate by a person (registry: candidate-ai-disclosure-and-explanation — the
//     screen-out already carries its score-against-threshold explanation instead).
//
// And nothing else:
//   * `role_closed` and `rematched` read as "not selected" on the status page, but nobody
//     decided about THIS candidate — the role closed under them, or they were moved to a
//     better-fit role. There is no interview judgement to report.
//   * `declined` is the CANDIDATE's own decision (they turned an offer down) and reads as
//     "withdrawn" to them, not "not selected" (application-status.ts).
//   * a live entry has no decision yet.
//   * consent withheld (expired or anonymized) — no letter, and the page is told nothing.
//   * no recorded interview — the letter is ABOUT the AI interview; with no scorecard on
//     record there is nothing a letter could report, and offering one would promise feedback
//     the record cannot back (registry: say only what the record holds).

import { consentWithholdsPii, type ConsentSnapshot } from "./consent";
import { LETTER_MAX_CHARS, type CandidateLetterView, type InterviewLetter } from "./interview-letter-types";

/** The two decisions a letter may follow. The outcome shapes the letter's FRAME (how it
 *  opens and closes), never its content (which competencies it names). */
export const LETTER_OUTCOMES = ["not_selected", "hired"] as const;
export type LetterOutcome = (typeof LETTER_OUTCOMES)[number];

export function isLetterOutcome(value: unknown): value is LetterOutcome {
  return typeof value === "string" && (LETTER_OUTCOMES as readonly string[]).includes(value);
}

/** The pipeline event kinds that put an entry into `rejected`. `actOnPipelineEntry`
 *  ('reject') is the ONLY writer of that status (db/pipeline.ts), and it writes exactly
 *  one of these two kinds inside the same transaction as the status flip: `rejected` for
 *  a person's click, `auto_rejected` when the caller passed actor "system" (the screen
 *  wave, the guided simulation). */
export const LETTER_REJECT_EVENT_KINDS = ["rejected", "auto_rejected"] as const;

/** The event that decided a rejection: the NEWEST reject-kind event on the entry. While
 *  the entry is `rejected`, that event is the one that put it there — a reinstatement
 *  flips the status back to `active` (reinstatePipelineEntry), so an older reject that was
 *  reversed can never be the newest one on a still-rejected entry. */
export type LetterDecidingEvent = { kind: string; actor: string | null };

/** Who made the deciding reject: the SAME three-state rule the candidate's own decision
 *  history applies (status-decisions.ts `sealedActorAttribution`) — the actor prefix is
 *  authoritative ("human:…" / "auto:…"), and only an actor-less legacy row falls back to
 *  the kind (`rejected` is the human routes' kind, `auto_rejected` the machine's; the shared
 *  map in decision-attribution.ts says the same). Anything else is `unknown`, and unknown is
 *  never a person.
 *
 *  Restated for the two reject kinds rather than imported: this module rides the task hub's
 *  import graph (tasks.ts → interview-letter-run.ts), and the shared kind map is a 35 KB
 *  module every route that starts a task would pay for on first hit, to answer a question
 *  about two kinds. interview-letter-policy.test.ts pins this function EQUAL to
 *  sealedActorAttribution over both reject kinds and every actor shape, so the two cannot
 *  drift. It is only ever handed a reject kind (interviewLetterDecidingEvent reads no other);
 *  any other kind with no actor prefix reads `unknown` — stricter, never a person. */
export function letterEventAttribution(event: LetterDecidingEvent): "human" | "automated" | "unknown" {
  const actor = event.actor ?? "";
  if (actor.startsWith("auto:")) return "automated";
  if (actor.startsWith("human:")) return "human";
  if (event.kind === "rejected") return "human";
  if (event.kind === "auto_rejected") return "automated";
  return "unknown";
}

/** Why a letter cannot be requested. Server-side only — never on the public wire: the
 *  door answers ONE refusal for all of them, so it cannot be used to learn whether a
 *  candidate was screened out by a machine or whether their consent lapsed. */
export type LetterIneligibleReason =
  | "consent_withheld"
  | "no_decision"
  | "automated_decision"
  | "unattributed_decision"
  | "not_decided_about_candidate"
  | "candidate_withdrew"
  | "no_interview";

export type LetterEligibility = { eligible: true; outcome: LetterOutcome } | { eligible: false; reason: LetterIneligibleReason };

export type LetterEligibilityInput = {
  /** pipeline_entries.status, raw — `rejected` / `role_closed` / `rematched` all read as
   *  `not_selected` to the candidate, and only the first is a decision about them. */
  entryStatus: string;
  /** Whether the entry's stage is the board's terminal (hired) stage — resolved by the
   *  caller through the workspace's own axis (roleOf === "terminal"), never by the
   *  literal stage name "Hired", which a renamed column would not match. */
  atTerminalStage: boolean;
  /** The newest reject-kind event on the entry, or null when there is none. */
  decidingEvent: LetterDecidingEvent | null;
  consent: ConsentSnapshot;
  /** Whether a recorded interview scorecard exists for this application. A thunk is read
   *  only once a decision already qualifies — the status page polls every 45 s, and a live
   *  candidate's poll must not pay for an interview read whose answer cannot matter. */
  hasInterviewRecord: boolean | (() => boolean);
};

/** The whole eligibility rule. See the header for why each branch is what it is. */
export function letterEligibility(input: LetterEligibilityInput, nowMs: number = Date.now()): LetterEligibility {
  if (consentWithholdsPii(input.consent, nowMs)) return { eligible: false, reason: "consent_withheld" };
  const decided = decidedOutcome(input);
  if (!decided.eligible) return decided;
  const hasInterview = typeof input.hasInterviewRecord === "function" ? input.hasInterviewRecord() : input.hasInterviewRecord;
  if (!hasInterview) return { eligible: false, reason: "no_interview" };
  return decided;
}

function decidedOutcome(input: LetterEligibilityInput): LetterEligibility {
  switch (input.entryStatus) {
    case "rejected": {
      const event = input.decidingEvent;
      // Fail CLOSED on a rejected entry with no reject event at all (a seeded row, a
      // legacy import): who decided is unknowable, and "a person decided" is exactly the
      // claim the letter would make.
      if (!event) return { eligible: false, reason: "unattributed_decision" };
      // The candidate-facing three-state attribution (letterEventAttribution above):
      // the actor prefix is authoritative, a legacy actor-less row falls back to the kind,
      // and `unknown` never passes.
      const attribution = letterEventAttribution(event);
      if (attribution === "human") return { eligible: true, outcome: "not_selected" };
      return { eligible: false, reason: attribution === "automated" ? "automated_decision" : "unattributed_decision" };
    }
    case "role_closed":
    case "rematched":
      return { eligible: false, reason: "not_decided_about_candidate" };
    case "declined":
      return { eligible: false, reason: "candidate_withdrew" };
    case "active":
      return input.atTerminalStage ? { eligible: true, outcome: "hired" } : { eligible: false, reason: "no_decision" };
    default:
      // An unknown status (a foreign writer, a future value) is not a decision we can
      // name. Fail closed.
      return { eligible: false, reason: "no_decision" };
  }
}

/** A view that says nothing: no button, no state, no text. What a candidate whose consent
 *  is withheld sees, and what a page with no letter and no eligibility sees. */
export const EMPTY_LETTER_VIEW: CandidateLetterView = Object.freeze({
  canRequest: false,
  state: null,
  requestedAt: null,
  text: null,
});

/** The candidate's projection of their letter. Exactly the four contract fields — no
 *  draft, no reviewer, no ids, no delivery detail — and the approved text only once the
 *  letter is `sent`. Consent withheld blanks everything, including a letter that was
 *  already sent: the same read-time PII gate every other boundary applies (consent.ts). */
export function candidateLetterView(
  letter: Pick<InterviewLetter, "state" | "requestedAt" | "finalText"> | null,
  eligibility: LetterEligibility,
  consent: ConsentSnapshot,
  nowMs: number = Date.now()
): CandidateLetterView {
  if (consentWithholdsPii(consent, nowMs)) return { ...EMPTY_LETTER_VIEW };
  if (letter) {
    return {
      // One request per application: once a letter exists the candidate is shown its
      // state, never a second button.
      canRequest: false,
      state: letter.state,
      requestedAt: letter.requestedAt,
      text: letter.state === "sent" ? letter.finalText : null,
    };
  }
  return { ...EMPTY_LETTER_VIEW, canRequest: eligibility.eligible };
}

/** Why a letter text cannot be stored, or null when it can. The cap is the contract's
 *  LETTER_MAX_CHARS, checked at every write boundary (the store refuses what this
 *  refuses). A letter is never truncated to fit: a cut sentence is no longer the sentence
 *  a person approved. */
export type LetterTextProblem = "empty" | "too_long";

export function letterTextProblem(text: unknown): LetterTextProblem | null {
  if (typeof text !== "string" || !text.trim()) return "empty";
  if (text.length > LETTER_MAX_CHARS) return "too_long";
  return null;
}
