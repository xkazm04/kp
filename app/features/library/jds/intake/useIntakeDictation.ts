"use client";

import { useEffect, useState } from "react";
import { useStt, type SttPhase } from "@/packages/voice-stt/src/react/useStt";
import { STT_UNAVAILABLE_CODE } from "./intakeVoiceIo";
import { useUnavailableLatch } from "./useUnavailableLatch";

/*
 * The intake composer's INPUT pipeline — capture → transcript → an editable
 * field. One of the two halves of the voice pair; it shares nothing with
 * useIntakeSpeech but a row in the composer, which is the point (the registry's
 * voice-io subject: two independent pipelines, and this one's currency is
 * TRUST).
 *
 * A THIN WRAPPER, deliberately. `packages/voice-stt` already owns the permission
 * dance, MediaRecorder's container negotiation, the encode to what whisper.cpp
 * reads, the abort and the phase table — all of it proven there. What this hook
 * owns is what is intake's:
 *
 *   1. WHERE THE TRANSCRIPT GOES. `onDictated` appends into the composer draft
 *      and nothing sends. A mic that sent on release would make every
 *      transcription error a message the agent has to be corrected out of.
 *   2. THE LATCH. `STT_UNAVAILABLE` is a server-config fact, so the control goes
 *      quiet and names the reason; every other failure leaves it live (see
 *      intakeVoiceIo.latchUnavailable). The package already latches its own
 *      `unavailable`; this one is ORed with it so the surface has a single
 *      truth even if the package's latch is later cleared by a probe this
 *      surface never runs.
 *   3. THE LEVEL. "Capture without a continuously visible indicator is
 *      surveillance-shaped regardless of intent" — and a flat meter during
 *      speech is the only tool a requestor has to debug their own audio.
 *
 * WHY A SECOND STREAM FOR THE METER. `useStt` keeps its MediaStream private (it
 * owns the recording indicator's lifetime, which is the right call), so metering
 * taps its own `getUserMedia` while the capture runs. The permission is already
 * granted at that point, so no second prompt appears; if the device refuses a
 * second reader anyway the meter reports `metered: false` and the surface falls
 * back to a plain listening indicator — a bar stuck at zero would be a FALSE
 * diagnosis ("we cannot hear you") of a working microphone.
 */

/** How much the raw RMS is amplified for the display. Speech RMS sits well under
 *  0.25, so the bar would otherwise never leave its left edge. The same gain the
 *  interview mic test uses, so the two meters read alike. */
const LEVEL_GAIN = 4;

export type IntakeDictation = {
  phase: SttPhase;
  /** True while a press must not start a new capture (arming, encoding, uploading). */
  busy: boolean;
  /** True while audio is flowing — the state that owes a visible indicator. */
  listening: boolean;
  /** Sticky: nothing on this install can listen, so the control stops being offered. */
  unavailable: boolean;
  /** The route's machine code for the last failure, for `useErrorMessage`. Null
   *  for a transport or microphone fault the server never named. */
  errorCode: string | null;
  /** Press: start when idle, finish when recording. One control, one meaning. */
  toggle: () => void;
  /** 0..1, live while listening. */
  level: number;
  /** False when the level could not be measured — do not paint a bar. */
  metered: boolean;
};

export function useIntakeDictation({
  lang,
  onDictated,
}: {
  lang: string;
  onDictated: (text: string) => void;
}): IntakeDictation {
  // Handed straight to the package: `useStt` already keeps the callback in a ref
  // of its own, so an inline arrow from the composer does not rebuild the capture
  // machine on every keystroke.
  const stt = useStt({ endpoint: "/api/stt", language: lang, onTranscript: onDictated });
  const latched = useUnavailableLatch(stt.errorCode, STT_UNAVAILABLE_CODE);

  const listening = stt.phase === "recording";
  const { level, metered } = useMicLevel(listening);

  return {
    phase: stt.phase,
    busy: stt.busy,
    listening,
    unavailable: stt.unavailable || latched,
    errorCode: stt.errorCode,
    toggle: stt.toggle,
    level,
    metered,
  };
}

/** A live input level while `active`, or `metered: false` if this machine will
 *  not give us a second reader on the device. Self-contained: its own stream,
 *  its own analyser, released the moment `active` goes false or the component
 *  unmounts — an analyser that outlived the capture would hold the microphone
 *  open with nothing on screen saying so. */
export function useMicLevel(active: boolean): { level: number; metered: boolean } {
  const [level, setLevel] = useState(0);
  const [metered, setMetered] = useState(false);

  useEffect(() => {
    // No state is touched on this arm: an idle meter is already zero, and the
    // reset for the arm that DID open a device happens in its cleanup below.
    if (!active) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf: number | null = null;

    const release = () => {
      stopped = true;
      if (raf != null) cancelAnimationFrame(raf);
      raf = null;
      for (const track of stream?.getTracks() ?? []) track.stop();
      stream = null;
      try {
        void ctx?.close();
      } catch {
        // Best-effort: a context the browser already tore down (tab hidden, the
        // device unplugged) throws here and there is nothing left to release.
      }
      ctx = null;
      setLevel(0);
      setMetered(false);
    };

    void (async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (stopped) {
          for (const track of media.getTracks()) track.stop();
          return;
        }
        stream = media;
        const Ctx =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        ctx = new Ctx();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(media).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        setMetered(true);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          setLevel(Math.min(1, Math.sqrt(sum / data.length) * LEVEL_GAIN));
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        // The capture itself is unaffected: only the meter is missing, and
        // `metered` staying false is what stops the surface from painting a
        // flat bar that would read as "your microphone is dead".
        if (!stopped) setMetered(false);
      }
    })();

    return release;
  }, [active]);

  return { level, metered };
}
