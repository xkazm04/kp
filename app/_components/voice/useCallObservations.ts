"use client";

// The three observations only the candidate's BROWSER can make (spark
// ai-interview-parity): where the tab went, and how an answer sat in time.
//
// READ THE DOCTRINE BEFORE EXTENDING THIS. These are OBSERVATIONS, never scores and
// never judgements (registry: ai-assistance-detection-and-fairness — observed-
// process-is-supporting-not-load-bearing). Nothing here changes what the candidate
// sees, nothing warns them, nothing is "flagged". A tab switch is a candidate
// checking the job ad; a long pause is a candidate thinking. The record says what
// happened and a human reads it in context — that is the entire contract, and it is
// why this hook has no return value the UI could branch on.
//
// The arithmetic lives in `call-observations.ts` (pure, tested); this is the wiring:
// two document listeners and three notifications the transports call.

import { useCallback, useEffect, useRef } from "react";
import type { DirectorClientEvent } from "@/app/_lib/voice/director-types";
import { answerTiming, awayMs, focusDuring } from "./call-observations";

export type UseCallObservationsArgs = {
  /** Observe only while the call is up. */
  live: boolean;
  /** Is the interviewer's audio playing? (decides `focus_lost.during`) */
  isInterviewerSpeaking: () => boolean;
  /** Queue an observation for the director. */
  onEvent: (event: DirectorClientEvent) => void;
};

export type CallObservations = {
  /** Server VAD / the SDK's VAD heard the candidate start or stop. */
  noteCandidateSpeech: (state: "started" | "stopped") => void;
  /** The interviewer's audio started or finished. The pre-answer silence is
   *  measured from the finish. */
  noteInterviewerAudio: (state: "started" | "done") => void;
  /** A candidate turn just finalized with this seq — the moment the timing
   *  observation can name the turn it belongs to. */
  noteCandidateTurn: (turnSeq: number) => void;
  /** Whether the candidate is mid-utterance (the presence and `focus_lost.during`
   *  both ask). */
  isCandidateSpeaking: () => boolean;
};

export function useCallObservations({ live, isInterviewerSpeaking, onEvent }: UseCallObservationsArgs): CallObservations {
  const liveRef = useRef(live);
  const speakingRef = useRef(isInterviewerSpeaking);
  const emitRef = useRef(onEvent);
  useEffect(() => {
    liveRef.current = live;
    speakingRef.current = isInterviewerSpeaking;
    emitRef.current = onEvent;
  });

  // Per-answer timing state. Refs, not state: none of it is rendered, and an
  // utterance boundary must not cost a re-render of the call shell.
  const speechStartRef = useRef<number | null>(null);
  const speechStopRef = useRef<number | null>(null);
  const interviewerEndRef = useRef<number | null>(null);
  const candidateSpeakingRef = useRef(false);
  // Away-state, so blur and visibilitychange — which fire together when a tab is
  // switched — report ONE departure and ONE return rather than four events.
  const awayAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!live) {
      // A call that ends while the tab is hidden leaves no dangling departure to be
      // "returned" from on the next call.
      awayAtRef.current = null;
      return;
    }
    const leave = () => {
      if (awayAtRef.current !== null) return;
      awayAtRef.current = Date.now();
      emitRef.current({
        kind: "focus_lost",
        at: new Date().toISOString(),
        during: focusDuring({
          interviewerSpeaking: speakingRef.current(),
          candidateSpeaking: candidateSpeakingRef.current,
        }),
      });
    };
    const back = () => {
      const left = awayAtRef.current;
      if (left === null) return;
      awayAtRef.current = null;
      emitRef.current({ kind: "focus_returned", at: new Date().toISOString(), awayMs: awayMs(left, Date.now()) });
    };
    const onVisibility = () => (document.visibilityState === "hidden" ? leave() : back());
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", leave);
    window.addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", back);
    };
  }, [live]);

  const noteCandidateSpeech = useCallback((state: "started" | "stopped") => {
    if (!liveRef.current) return;
    if (state === "started") {
      candidateSpeakingRef.current = true;
      speechStartRef.current = Date.now();
      speechStopRef.current = null;
    } else {
      candidateSpeakingRef.current = false;
      speechStopRef.current = Date.now();
    }
  }, []);

  const noteInterviewerAudio = useCallback((state: "started" | "done") => {
    if (state === "done") interviewerEndRef.current = Date.now();
  }, []);

  const noteCandidateTurn = useCallback((turnSeq: number) => {
    if (!liveRef.current || turnSeq < 0) return;
    const timing = answerTiming({
      speechStartMs: speechStartRef.current,
      speechStopMs: speechStopRef.current,
      interviewerAudioEndMs: interviewerEndRef.current,
    });
    // Nothing measurable is nothing to record: an event with two nulls is noise in
    // the evidence view, and the absence of a row says the same thing more honestly.
    if (timing.preSilenceMs !== null || timing.durationMs !== null) {
      emitRef.current({ kind: "answer_timing", at: new Date().toISOString(), turnSeq, ...timing });
    }
    speechStartRef.current = null;
    speechStopRef.current = null;
  }, []);

  const isCandidateSpeaking = useCallback(() => candidateSpeakingRef.current, []);

  return { noteCandidateSpeech, noteInterviewerAudio, noteCandidateTurn, isCandidateSpeaking };
}
