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
// "completed" therefore means: the call reached the live phase and exchanged at
// least one real turn AND either ended cleanly OR — even if an error fired late —
// had already captured a SUBSTANTIVE conversation (>= SUBSTANTIVE_TURNS turns).
// bug-ui-scan-2026-07-09 (voice-interview #2): the old rule made ANY error
// strictly disqualifying, so a fully-answered 20-minute interview whose socket
// blipped at goodbye (flaky mobile WebRTC drop, or ElevenLabs onError→onDisconnect
// after many turns) finalized "failed" — /api/interview/complete then skipped
// scoring and the scorecard_review approval that drives the Interview→Offer gate
// never landed, silently stalling a real screen. We now decouple "clean teardown"
// from "scoreable": a late blip on a substantive call still counts, while a short
// blip (the 2-second connect flap the strict rule was built for) stays "failed".
// Every "failed" ending makes /api/interview/complete skip scoring (it gates on
// status === "completed") and lets the candidate re-enter the tokenized link
// rather than being locked out by an "already completed" screen. This is the
// single source of truth for that decision so the client's finalize() call sites
// can't drift.

export type InterviewEndSignals = {
  /** An onError fired at some point during this call (provider/network error). */
  errored: boolean;
  /** The call reached the live phase (ElevenLabs onConnect / OpenAI answer applied). */
  reachedLive: boolean;
  /** Number of real transcript turns captured during the call (any role). */
  turnCount: number;
  /** Number of turns spoken by the CANDIDATE. A call where only the AI interviewer
   *  spoke (silent-mic / VAD never triggered) has candidateTurnCount === 0 and must
   *  NOT count as a real interview (voice-interview #1) — the agent always opens, so
   *  turnCount alone is satisfied by the greeting even when the candidate said
   *  nothing. */
  candidateTurnCount: number;
};

export type InterviewFinalStatus = "completed" | "failed";

// How many real turns make a live call "substantive" — enough of a conversation
// that a late transport error no longer disqualifies it from being scored. A
// short connect flap (0–few turns) stays below this and is still "failed", so a
// 2-second blip can never masquerade as a fully interviewed applicant.
// bug-ui-scan-2026-07-09 (voice-interview #2).
export const SUBSTANTIVE_TURNS = 6;

/** Map the end-of-call signals to the status persisted for the session. A call
 *  is "completed" when it went live and produced at least one turn AND either no
 *  error fired OR it had already captured a substantive conversation
 *  (>= SUBSTANTIVE_TURNS turns) before the error — so a late blip on a real
 *  interview is still scored. Everything else is "failed". */
export function interviewFinalStatus(signals: InterviewEndSignals): InterviewFinalStatus {
  // A "real conversation" requires the CANDIDATE to have spoken at least once, not
  // merely a turn of any role (voice-interview #1). The interviewer always opens
  // ("Tell me about your recent work…"), so a silent-mic call — hardware fault, OS
  // mute, VAD never firing — would otherwise satisfy turnCount > 0 with the greeting
  // alone and finalize "completed": the session goes terminal (candidate locked out),
  // minutes are billed, and the scorecard that feeds the Interview→Offer gate is
  // computed from a transcript with zero candidate words.
  const hadRealConversation = signals.reachedLive && signals.candidateTurnCount > 0;
  if (!hadRealConversation) return "failed";
  // bug-ui-scan-2026-07-09 (voice-interview #2): an error only fails a call that
  // hadn't yet become a substantive conversation; past the threshold the captured
  // transcript is scoreable regardless of how the socket closed.
  if (signals.errored && signals.turnCount < SUBSTANTIVE_TURNS) return "failed";
  return "completed";
}

/** The status a page-unload/unmount beacon should persist. bug-ui-scan-2026-07-09
 *  (voice-interview #5): the unmount beacon used to hardcode "failed", which
 *  downgraded a *cleanly ended* call whose End() was still in flight when the tab
 *  closed (before ElevenLabs onDisconnect fired) — dropping its scorecard. When an
 *  End is in flight we beacon the REAL verdict (a substantive live call becomes
 *  "completed"); a true abandonment (unmount while live, no End clicked) stays
 *  conservatively "failed" so a half-finished screen is never scored as passed. */
export function unmountBeaconStatus(endInFlight: boolean, signals: InterviewEndSignals): InterviewFinalStatus {
  return endInFlight ? interviewFinalStatus(signals) : "failed";
}
