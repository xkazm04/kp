// The arithmetic behind the three observations only the candidate's BROWSER can make
// (spark ai-interview-parity), plus the client-side hard stop.
//
// Pure on purpose. These numbers end up in interview_events and, through them, in a
// recruiter's evidence view, so "how was this measured?" has to be answerable from a
// test rather than from a callback buried in a transport.
//
// DOCTRINE, and it is load-bearing: an observation is NEVER scored, never shown to the
// candidate, and never a reason for the UI to behave differently (registry:
// ai-assistance-detection-and-fairness — observed-process-is-supporting-not-load-
// bearing). A long pre-answer silence is a candidate thinking; a tab switch is a
// candidate reading the job ad. The record says what happened, and a human reads it.

import type { DirectorClientEvent } from "@/app/_lib/voice/director-types";

/** Who held the floor when something was observed — the contract's own vocabulary,
 *  narrowed off the event union so a change there is a type error here. */
export type SpeakingWho = Extract<DirectorClientEvent, { kind: "focus_lost" }>["during"];

/** What `focus_lost` records as `during`. The interviewer wins a tie: it is the one
 *  whose words the candidate would have been missing. */
export function focusDuring(state: {
  interviewerSpeaking: boolean;
  candidateSpeaking: boolean;
}): SpeakingWho {
  if (state.interviewerSpeaking) return "interviewer";
  if (state.candidateSpeaking) return "candidate";
  return "idle";
}

/** How long the tab was away. Never negative, and a missing/implausible start makes
 *  it 0 rather than a fabricated duration. */
export function awayMs(leftAtMs: number | null, returnedAtMs: number): number {
  if (leftAtMs === null || !Number.isFinite(leftAtMs) || !Number.isFinite(returnedAtMs)) return 0;
  return Math.max(0, Math.round(returnedAtMs - leftAtMs));
}

export type AnswerTimingInput = {
  /** When the provider said the candidate started speaking. */
  speechStartMs: number | null;
  /** When it said they stopped. Null while the provider exposes no stop event. */
  speechStopMs: number | null;
  /** When the interviewer's audio last finished, or null if it never has (the
   *  candidate spoke first) or the provider does not expose it. */
  interviewerAudioEndMs: number | null;
};

/** The two numbers `answer_timing` carries. Either can be null, and null is the
 *  honest answer when the provider does not expose the event it would come from —
 *  never a zero, which would read as an instant answer. */
export function answerTiming(input: AnswerTimingInput): { preSilenceMs: number | null; durationMs: number | null } {
  const { speechStartMs, speechStopMs, interviewerAudioEndMs } = input;
  const usable = (v: number | null): v is number => v !== null && Number.isFinite(v);
  // A negative pre-silence means the candidate spoke over the interviewer (barge-in),
  // which is not a silence at all — record nothing rather than a nonsense number.
  const preSilenceMs =
    usable(speechStartMs) && usable(interviewerAudioEndMs) && speechStartMs >= interviewerAudioEndMs
      ? Math.round(speechStartMs - interviewerAudioEndMs)
      : null;
  const durationMs =
    usable(speechStartMs) && usable(speechStopMs) && speechStopMs >= speechStartMs
      ? Math.round(speechStopMs - speechStartMs)
      : null;
  return { preSilenceMs, durationMs };
}

// ---- the end-of-call handshake ------------------------------------------------------

/** How long the interviewer must be quiet before an `endCall` is acted on. Chosen
 *  against the OpenAI path's level meter, which dips below its threshold BETWEEN
 *  WORDS: a between-word gap is a few hundred milliseconds, so 1.2 s of quiet is an
 *  utterance that really has finished rather than a comma. */
export const END_QUIET_MS = 1200;
/** How long to let the closing line START before quiet counts as "finished".
 *
 *  This is the half that is easy to get wrong. `endCall` arrives in the SAME response
 *  that answers `end_interview`, so at that instant the model has not said its goodbye
 *  yet and the interviewer is — correctly — silent. Ending on THAT silence hangs up a
 *  beat before "thanks for your time", which is the last thing a candidate hears from
 *  the company. So the handshake waits for the line to begin, and only then for it to
 *  end; if it never begins, this grace expires and the call ends anyway. */
export const END_START_GRACE_MS = 4000;
/** A speaking flag that never clears (a stuck analyser, a provider that stopped
 *  reporting) must not hold a finished interview open forever. */
export const END_MAX_WAIT_MS = 30_000;

/** Whether the browser may now end the call, given what it has observed since
 *  `endCall` arrived. Pure, so the whole handshake is a table rather than a timing
 *  argument spread across a polling closure. */
export function endHandshakeDone(s: {
  /** Milliseconds since `endCall` arrived. */
  elapsedMs: number;
  /** How long the interviewer has been continuously quiet, or null while speaking. */
  quietMs: number | null;
  /** The closing line was heard at least once. */
  spoke: boolean;
}): boolean {
  if (s.elapsedMs >= END_MAX_WAIT_MS) return true;
  const mayEnd = s.spoke || s.elapsedMs >= END_START_GRACE_MS;
  return mayEnd && s.quietMs !== null && s.quietMs >= END_QUIET_MS;
}

/** Minutes past the agenda's hard cap at which the BROWSER ends the call by itself.
 *  The same grace the server's director uses (voice/director.ts END_GRACE_MIN) — the
 *  client stop exists for the case the server cannot be reached at all, so the two
 *  must not disagree about when a call is over. */
export const CLIENT_HARD_STOP_GRACE_MIN = 2;

/** How long from NOW until the client hard stop, or null when this call has no
 *  agenda (an undirected call keeps today's behaviour: it runs until someone ends it).
 *
 *  `priorElapsedSec` is the live time earlier attempts already spent (ResumeContext
 *  .elapsedSec): a call resumed at minute 28 of a 30-minute agenda must stop in
 *  minutes, not restart the whole clock. Already past the cap ⇒ 0, i.e. stop now. */
export function hardStopDelayMs(args: {
  hardCapMin: number | null | undefined;
  priorElapsedSec: number;
  graceMin?: number;
}): number | null {
  const cap = args.hardCapMin;
  if (typeof cap !== "number" || !Number.isFinite(cap) || cap <= 0) return null;
  const grace = args.graceMin ?? CLIENT_HARD_STOP_GRACE_MIN;
  const prior = Number.isFinite(args.priorElapsedSec) ? Math.max(0, args.priorElapsedSec) : 0;
  return Math.max(0, Math.round((cap + grace) * 60_000 - prior * 1000));
}
