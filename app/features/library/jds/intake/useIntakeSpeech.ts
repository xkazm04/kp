"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTts, type TtsPlayback } from "@/packages/voice-tts/src/react/useTts";
import { speechReady } from "@/packages/voice-tts/src/text/normalize";
import { TTS_UNAVAILABLE_CODE, readAutoSpeak, shouldAutoSpeak, storeAutoSpeak } from "./intakeVoiceIo";
import { useUnavailableLatch } from "./useUnavailableLatch";

/*
 * The intake composer's OUTPUT pipeline — an agent turn, read aloud. The other
 * half of the voice pair, and independent of the dictation half in every way
 * that matters: a machine with no whisper.cpp still speaks, and a machine with
 * no Piper still dictates.
 *
 * A THIN WRAPPER over `packages/voice-tts`, which already owns the utterance
 * queue, the chunk pipelining that wins time-to-first-audio, the blocked-autoplay
 * state and — the absolute this surface would otherwise have to re-implement —
 * "stop means now": a generation token, an abort of pending synthesis and the
 * release of the audio element, including on unmount.
 *
 * WHAT IS THIS SURFACE'S:
 *
 *   1. THE ONE DOOR. `speechReady` runs HERE, before the package sees the text,
 *      so an agent turn written for a 30rem column ("**Must have**: Kafka,
 *      2+ yrs") is not voiced as "asterisk asterisk". Running it here rather
 *      than passing `format: "chat"` means this hook's own answer is exactly
 *      what the engine receives — an empty string means there is genuinely
 *      nothing to say, which is what lets the bar decide whether to offer the
 *      control at all instead of rendering one that does nothing.
 *   2. THE STANDING OPT-IN. Auto-speak is a per-browser preference, OFF by
 *      default, primed on mount so a reopened session is never spoken at
 *      somebody who has just arrived, and de-duped by text identity so a
 *      keystroke in the composer does not restart the utterance. The decision
 *      is `shouldAutoSpeak` in intakeVoiceIo.ts, where it is testable.
 *   3. THE LATCH. `TTS_UNAVAILABLE` is a server-config fact; the control goes
 *      quiet and names the reason, and every other failure leaves it live.
 *
 * NO PROBE ON MOUNT. `GET /api/tts` probes every configured provider, and the
 * intake panel is mounted for the whole session while most sessions never press
 * play. Availability is learned by ATTEMPTING: the route answers 503 with a
 * typed code, and the surface says so in the reader's language.
 */

export type IntakeSpeech = {
  playback: TtsPlayback;
  /** True while this surface is synthesizing, waiting or playing. */
  speaking: boolean;
  /** The browser refused un-gestured audio; the control becomes a resume. */
  blocked: boolean;
  /** Sticky: nothing on this install can speak. */
  unavailable: boolean;
  /** The route's machine code for the last failure, for `useErrorMessage`. */
  errorCode: string | null;
  /** Speak one text now, superseding whatever was playing. Already normalized. */
  speak: (text: string) => void;
  /** Immediate: audio halts and pending synthesis aborts. */
  stop: () => void;
  /** Resume a blocked playback. Must be called from a user gesture. */
  resume: () => void;
  autoSpeak: boolean;
  setAutoSpeak: (value: boolean) => void;
};

export function useIntakeSpeech({
  speakText,
  lang,
  sessionKey = null,
}: {
  speakText: string | null;
  lang: string;
  /** The intake session this text belongs to. Switching sessions re-primes and
   *  silences: the last answer of a session just opened is not an arrival, and
   *  the previous session's utterance must not keep playing over it. */
  sessionKey?: string | null;
}): IntakeSpeech {
  const tts = useTts({ endpoint: "/api/tts" });
  const { speak: ttsSpeak, stop: ttsStop, resume: ttsResume, playback, errorCode } = tts;

  const latched = useUnavailableLatch(errorCode, TTS_UNAVAILABLE_CODE);

  // Read lazily, the SSR-safe shape its neighbour in this directory already uses
  // (the desk's stored zones, coats/studioContract.ts): the reader is `window`-guarded,
  // so a server render takes the default and the browser takes the stored value
  // on its first paint rather than flipping the control a tick later.
  const [autoSpeak, setAutoSpeakState] = useState<boolean>(readAutoSpeak);
  const setAutoSpeak = useCallback((value: boolean) => {
    setAutoSpeakState(value);
    storeAutoSpeak(value);
  }, []);

  const speak = useCallback(
    (text: string) => {
      const ready = speechReady(text);
      if (!ready) return;
      // `format: "plain"` because the door already ran: the package would run it
      // again harmlessly (it is idempotent), but the repo keeps one call site
      // per utterance for the one function that is supposed to have exactly one.
      void ttsSpeak({ text: ready, language: lang, format: "plain" });
    },
    [ttsSpeak, lang]
  );

  const stop = useCallback(() => ttsStop(), [ttsStop]);
  const resume = useCallback(() => void ttsResume(), [ttsResume]);

  // The standing opt-in. Everything it decides lives in `shouldAutoSpeak`; this
  // effect only supplies the four facts and remembers what it started.
  const spokenRef = useRef<string | null>(null);
  const primedRef = useRef(false);
  const sessionRef = useRef<string | null>(sessionKey);
  useEffect(() => {
    if (sessionRef.current !== sessionKey) {
      sessionRef.current = sessionKey;
      primedRef.current = false;
      spokenRef.current = null;
      // Stop means now, and it means now across a session switch too: audio from
      // the session the requestor just left is audio with no visible source.
      ttsStop();
    }
    const next = speechReady(speakText ?? "") || null;
    const visible = typeof document === "undefined" || document.visibilityState !== "hidden";
    const go = shouldAutoSpeak({ autoSpeak, visible, primed: primedRef.current, lastSpoken: spokenRef.current, next });
    primedRef.current = true;
    // Recorded whether or not it was spoken: a turn seen while the preference
    // was off, or while the tab was hidden, is not new any more, and speaking it
    // when the requestor comes back would be an answer arriving minutes late.
    spokenRef.current = next;
    if (go && next) speak(next);
  }, [speakText, autoSpeak, speak, sessionKey, ttsStop]);

  return {
    playback,
    speaking: playback === "synthesizing" || playback === "waiting" || playback === "playing",
    blocked: playback === "blocked",
    unavailable: latched,
    errorCode,
    speak,
    stop,
    resume,
    autoSpeak,
    setAutoSpeak,
  };
}
