// The interview FEEDBACK LETTER a candidate may request after a human decision
// (spark interview-feedback-letter).
//
// WHAT IT IS. After a person decided on a candidate — not selected, or hired — the
// candidate can ask, from their status page, for a short letter about their AI
// interview. A draft is prepared in THEIR language from the recorded scorecard; a
// recruiter edits it, owns every sentence, and approves or declines it; only an approved
// letter reaches the candidate, by email and on their status page.
//
// WHAT IT MAY SAY. Competencies in plain words — what went well, what to work on. It may
// NEVER quote the candidate's own words back to them, and never mention ratings, scores,
// the scorecard, the rubric or the model's confidence. That is a written rule of this
// repo (pipeline/jobfit/automation.py, the rejection letter's prompt) and of the
// registry (candidate-ai-disclosure-and-explanation: decisive facts, not the rationale;
// rejection-with-dignity: a longer note is acceptable only when a human owns every
// sentence). The draft is prepared by a machine; the letter is a person's.
//
// WHO MAY ASK. Only after a HUMAN decision. An automated screen-out keeps its
// score-against-threshold line and cannot request a letter, even when a named person
// approved the batch — nothing was decided about that one candidate by a person.

/** A letter's lifecycle. Every state is shown to the candidate honestly; none is a
 *  request left hanging (registry: a candidate's process never stalls on your
 *  constraints). */
export const LETTER_STATES = [
  // The candidate asked; nothing has been prepared yet.
  "requested",
  // A draft exists and waits for a recruiter.
  "drafted",
  // A recruiter approved the final text; delivery was attempted.
  "sent",
  // A recruiter decided not to send individual feedback. The candidate is told so.
  "declined",
] as const;
export type LetterState = (typeof LETTER_STATES)[number];

/** How the draft was produced. `template` is the keyless deterministic letter built from
 *  catalog copy and competency names — never presented as a model's writing. */
export type LetterDraftSource = "model" | "template";

/** Delivery, in the comms layer's own truthful vocabulary — a letter is never reported
 *  as received when the relay only accepted it. */
export type LetterDelivery = "sent" | "queued" | "failed";

/** One letter, as the RECRUITER's queue sees it. Server-side and operator-only. */
export type InterviewLetter = {
  id: string;
  workspaceId: string;
  entryId: string;
  state: LetterState;
  /** The candidate's language, resolved once at request time. */
  lang: string;
  requestedAt: string;
  draft: { text: string; source: LetterDraftSource; createdAt: string } | null;
  /** The human-owned final text. Set only by an approve. */
  finalText: string | null;
  /** Who approved or declined — the reviewing human, never the drafting machine. */
  decidedBy: string | null;
  decidedAt: string | null;
  delivery: LetterDelivery | null;
};

/** What the CANDIDATE's status page receives about their letter. A projection: no
 *  draft, no reviewer identity, no internal ids. `text` is present only once sent. */
export type CandidateLetterView = {
  /** Whether this candidate may ask at all (a human decision exists and no request
   *  was made yet). */
  canRequest: boolean;
  state: LetterState | null;
  requestedAt: string | null;
  /** The approved letter, once sent. */
  text: string | null;
};

/** Caps enforced at every write boundary. A letter is a short note, not a report. */
export const LETTER_MAX_CHARS = 2400;
