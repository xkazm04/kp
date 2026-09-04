// Candidate-consent policy for the voice interview (idea-98e6cf23). For an
// AI-conducted, transcribed interview the candidate's recorded consent is the
// legal basis for processing, so it cannot live only in the browser. The Start
// button stays disabled until the consent checkbox is ticked, but that is a UI
// convention, not a guarantee — a direct call to /api/interview/connect, or a
// future UI regression, could run and store a real candidate's interview with
// no consent on record.
//
// THE DECISION (pure, testable, documented here so it stops being a UI
// convention). Consent is a HARD precondition for candidate-mode sessions, and
// it is enforced server-side at the two points where it matters:
//
//   - /connect rejects (403) a candidate session whose request does not carry
//     explicit `consent === true`, BEFORE any provider credentials are minted or
//     the session flips to in_progress. So no un-consented candidate call ever
//     starts.
//   - /complete refuses (403) to persist a candidate transcript unless the
//     session already has a non-null `consent_at` recorded. This is the storage
//     invariant: a transcript is only saved when "we have consent" is a fact in
//     the row, not an assumption — defense in depth against a bypassed /connect
//     or a legacy session.
//
// Test/lab sessions (mode === "test") carry no real candidate — they are the
// ungrounded quick screen the recruiter runs against themselves — so they are
// NOT gated; their consent_at is still recorded when offered, but absence of it
// never blocks the call or the transcript.

export type InterviewMode = "test" | "candidate";

// The two refusals this module used to spell out as English constants
// (CONSENT_REQUIRED_ERROR / CONSENT_NOT_RECORDED_ERROR) are gone: /connect and
// /complete answer INTERVIEW_CONSENT_REQUIRED and INTERVIEW_CONSENT_NOT_RECORDED
// through jsonRefusal, so the reader gets the sentence in their own language and
// the wire carries the code. The constants outlived their consumers and their
// doc-comments still claimed the routes shared them — a second, stale source of
// truth for a contract that now lives in REFUSAL_ERRORS. The PREDICATES below are
// the part that was ever load-bearing; keep them here.

/** Whether recorded consent is legally required for this session mode. Only
 *  candidate-mode sessions screen a real person; test/lab runs do not. */
export function consentRequired(mode: InterviewMode): boolean {
  return mode === "candidate";
}

/** /connect precondition: may this call start? A candidate call requires the
 *  request to carry explicit `consent === true` (a truthy-but-not-true value is
 *  rejected); test sessions always pass. */
export function isConnectConsentSatisfied(mode: InterviewMode, consent: unknown): boolean {
  return !consentRequired(mode) || consent === true;
}

/** /complete invariant: may this session's transcript be persisted? A candidate
 *  session requires a non-null `consent_at` on its row; test sessions always
 *  pass. */
export function isPersistConsentSatisfied(mode: InterviewMode, consentAt: string | null | undefined): boolean {
  return !consentRequired(mode) || consentAt != null;
}
