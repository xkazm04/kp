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

/** How a call stopped. Only `drop` is involuntary — nobody decided it. */
export type InterviewEnding =
  /** The candidate pressed End (or the tab closed with an End in flight). */
  | "candidate_end"
  /** The director said so: `end_interview`, the close reserve, the hard cap. */
  | "director_end"
  /** A transport drop, a provider error, a connect that never came back. */
  | "drop";

/** What the DIRECTOR knew about the call when it stopped. Absent (or `directed:
 *  false`) for every undirected call — the lab, a session with nothing grounded to
 *  talk about, a pre-director link — and those keep the rule above unchanged. */
export type DirectedEndContext = {
  /** The connect returned an agenda, so the call was being directed. */
  directed: boolean;
  ending: InterviewEnding;
  /** A `role_qa` or `close` block has begun: the conversation reached its ending,
   *  whatever happened to the socket afterwards. */
  closingBegun: boolean;
};

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
 *  interview is still scored. Everything else is "failed".
 *
 *  A DIRECTED call adds one rule on top, because it changed what "the connection
 *  dropped" costs. Before the director, a drop was terminal: there was nothing to
 *  resume into, so finalizing a substantive-but-unfinished call "completed" at least
 *  got it scored. Now a `failed` session stays reconnectable AND the reconnect
 *  resumes — same agenda, covered blocks intact, the interviewer briefed not to start
 *  over. So a directed call that DROPS before its closing block has begun is an
 *  interview the candidate can still finish, and calling it "completed" would lock
 *  them out of their own link at (say) minute 12 of 30 and score the half of it that
 *  happened. Once `role_qa`/`close` has begun the conversation reached its ending and
 *  the old rule applies again — a drop at goodbye is still a completed interview.
 *
 *  `direction` is omitted by every undirected caller (the lab, a session with no
 *  agenda), and those keep the rule above byte for byte. */
export function interviewFinalStatus(
  signals: InterviewEndSignals,
  direction?: DirectedEndContext | null,
): InterviewFinalStatus {
  const base = baseFinalStatus(signals);
  if (base === "failed") return "failed";
  if (!direction || !direction.directed) return base;
  // The candidate's own End and the director's end_interview are DECISIONS — the
  // interview is over because somebody said so, wherever the agenda stood.
  if (direction.ending !== "drop") return base;
  if (direction.closingBegun) return base;
  return "failed";
}

function baseFinalStatus(signals: InterviewEndSignals): InterviewFinalStatus {
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
export function unmountBeaconStatus(
  endInFlight: boolean,
  signals: InterviewEndSignals,
  direction?: DirectedEndContext | null,
): InterviewFinalStatus {
  return endInFlight ? interviewFinalStatus(signals, direction) : "failed";
}
