"use client";

// The other half of "can we actually have this conversation" (spark
// ai-interview-parity).
//
// The pre-call check has always tested the MICROPHONE, and a silent microphone is
// only half of the ways a voice interview dead-ends. The other half is the candidate
// who cannot HEAR the interviewer — output routed to a disconnected Bluetooth
// headset, system volume at zero, the browser's per-tab mute. Those candidates used
// to discover it by sitting in silence after Start, and the autoplay-blocked recovery
// (which is a different fault) never fired, because the audio was playing perfectly
// into nothing.
//
// KEYLESS AND NETWORKLESS by construction: a WebAudio oscillator, not an asset and
// not a provider sample. It works on an install with no keys at all, which is exactly
// the install most likely to be reading this file.
//
// ADVISORY, ALWAYS. There is no browser API that can tell us a sound was heard, so
// the verdict is the candidate's own answer, it is never required, and no state here
// can block Start. A candidate who cannot hear the tone is told what to check and is
// still free to try the call — their headset may well come back before it matters.

import { useCallback, useEffect, useRef, useState } from "react";

export type SpeakerTestState =
  /** Not run. */
  | "idle"
  /** The tone is playing. */
  | "playing"
  /** The tone finished; waiting for the candidate's yes/no. */
  | "asking"
  /** They heard it. */
  | "heard"
  /** They did not — show what to check. */
  | "unheard"
  /** No WebAudio at all: we cannot make a sound to ask about. */
  | "unsupported";

/** How long the tone plays. Long enough to notice, short enough not to be rude in a
 *  shared room. */
export const SPEAKER_TONE_MS = 1100;
/** A quiet, friendly two-note figure rather than a bare test beep — A4 then E5. */
const TONE_HZ = [440, 659.25];
/** Peak gain. Deliberately low: this plays before anyone has set their volume for
 *  the call, and a loud surprise in a quiet room is its own kind of failure. */
const TONE_GAIN = 0.07;

export function useSpeakerTest() {
  const [speakerTest, setSpeakerTest] = useState<SpeakerTestState>("idle");
  const ctxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const teardown = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    try {
      void ctxRef.current?.close();
    } catch {
      /* an AudioContext that refuses to close is already gone as far as we care */
    }
    ctxRef.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  const playTone = useCallback(() => {
    teardown();
    const Ctx =
      typeof window === "undefined"
        ? undefined
        : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) {
      setSpeakerTest("unsupported");
      return;
    }
    try {
      const ctx = new Ctx();
      ctxRef.current = ctx;
      // Some browsers hand back a suspended context even from a click; resuming is
      // harmless when it is already running.
      void ctx.resume?.().catch(() => {
        /* a context that will not resume simply produces no sound — the candidate's
           own "no" below is what records that */
      });
      const now = ctx.currentTime;
      const step = SPEAKER_TONE_MS / 1000 / TONE_HZ.length;
      TONE_HZ.forEach((hz, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = hz;
        const start = now + i * step;
        // An envelope, not a switch: a square-edged start and stop is a click, which
        // on small laptop speakers is louder than the note itself.
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(TONE_GAIN, start + 0.04);
        gain.gain.setValueAtTime(TONE_GAIN, start + step - 0.06);
        gain.gain.linearRampToValueAtTime(0, start + step - 0.01);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + step);
      });
      setSpeakerTest("playing");
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setSpeakerTest((s) => (s === "playing" ? "asking" : s));
        teardown();
      }, SPEAKER_TONE_MS + 150);
    } catch {
      // WebAudio exists but refused (an exotic autoplay policy, an exhausted context
      // pool). We cannot ask about a sound we could not make.
      setSpeakerTest("unsupported");
      teardown();
    }
  }, [teardown]);

  /** The candidate's answer. This IS the verdict — no API can second-guess it. */
  const confirmHeard = useCallback((heard: boolean) => setSpeakerTest(heard ? "heard" : "unheard"), []);

  /** What start() runs before dialing, mirroring the mic test's reset: release the
   *  context and forget a verdict that belonged to the previous attempt. */
  const resetForCall = useCallback(() => {
    teardown();
    setSpeakerTest("idle");
  }, [teardown]);

  return { speakerTest, playTone, confirmHeard, stopSpeakerTest: teardown, resetSpeakerForCall: resetForCall };
}
