// Whether a finished voice call counts as a real, scoreable interview.
//
// The ElevenLabs SDK fires onDisconnect on EVERY socket close — including the
// one that immediately follows a provider/network error (onError → onDisconnect)
// and the one for a connect that never reached a live conversation. Finalizing
// all of those as "completed" persisted a truncated transcript that
// /api/interview/complete then scored, setting the scorecard_review approval
// that feeds the Interview→Offer gate (see runInterviewScorecard). A two-second
// connection blip would silently become a "fully interviewed, scored applicant"
// and a recruiter would make an offer call on a half-finished conversation.
//
// "completed" therefore means exactly one thing: the call reached the live
// phase, exchanged at least one real turn, and ended without an error firing.
// Every other ending is "failed", which makes /api/interview/complete skip
// scoring (it gates on status === "completed") and lets the candidate re-enter
// the tokenized link rather than being locked out by an "already completed"
// screen. This is the single source of truth for that decision so the client's
// finalize() call sites can't drift.

export type InterviewEndSignals = {
  /** An onError fired at some point during this call (provider/network error). */
  errored: boolean;
  /** The call reached the live phase (ElevenLabs onConnect / OpenAI answer applied). */
  reachedLive: boolean;
  /** Number of real transcript turns captured during the call. */
  turnCount: number;
};

export type InterviewFinalStatus = "completed" | "failed";

/** Map the end-of-call signals to the status persisted for the session. Only a
 *  call that went live, produced at least one turn, and saw no error is
 *  "completed"; everything else is "failed". */
export function interviewFinalStatus(signals: InterviewEndSignals): InterviewFinalStatus {
  const hadRealConversation = signals.reachedLive && signals.turnCount > 0;
  return signals.errored || !hadRealConversation ? "failed" : "completed";
}
