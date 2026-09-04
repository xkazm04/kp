// H5 follow-up: a pre-call mic test — confirm "we can hear you" before dialing, so a muted/dead
// mic is caught early (and a nervous candidate is reassured) rather than surfacing as a silent
// dead-end mid-call.
//
// Extracted from VoiceInterview.tsx. It is a fully self-contained island: its own
// stream/analyser/RAF refs, its own two pieces of state, and only two touchpoints with the
// rest of the component — `resetForCall()` at the top of start() (release the test mic before
// the real call claims the device) and `stopMicTest()` in the unmount cleanup. Both are
// returned as stable callbacks so the unmount effect keeps its empty dep array AND its
// original ordering (mic-test teardown last, after the OpenAI teardown) — a cleanup effect
// owned by this hook would have run FIRST instead.

import { useCallback, useRef, useState } from "react";
import { micErrorText } from "./micErrorText";

/** The verdict the panel renders. The three failure states are DISTINCT because
 *  their recovery steps are: grant a permission, plug a microphone in, close the
 *  app that is holding it. The hook used to answer "denied" to all three. */
export type MicTestState = "idle" | "testing" | "heard" | "silent" | "denied" | "not-found" | "busy";

/** How long the test samples the microphone. */
export const MIC_TEST_DURATION_MS = 4000;
/** Peak RMS above which we claim to have heard the candidate. Below it the mic is
 *  connected and permitted but producing (near-)silence — a muted headset. */
export const MIC_HEARD_RMS = 0.03;
/** How much the raw RMS is amplified for the level display. Speech RMS sits well
 *  under 0.25, so the bar would otherwise never leave its left edge. */
const MIC_LEVEL_GAIN = 4;

/** Classify a getUserMedia rejection through the SHARED classifier — the same table
 *  the interview shell and the intake voice surface already use, so one DOMException
 *  map exists in the repo. An unclassifiable rejection stays "denied": it is by far
 *  the most common cause, and its copy names a check the candidate can perform. */
export function micTestFailure(e: unknown): Extract<MicTestState, "denied" | "not-found" | "busy"> {
  const reason = micErrorText(e, { denied: "denied", notFound: "not-found", busy: "busy" });
  return reason === "not-found" || reason === "busy" ? reason : "denied";
}

/** The level as a whole, clamped percent — the number the progressbar reports and,
 *  under prefers-reduced-motion, the text that replaces the animated bar entirely. */
export function micLevelPercent(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.round(Math.min(1, Math.max(0, level)) * 100);
}

export function useMicTest() {
  const [micTest, setMicTest] = useState<MicTestState>("idle");
  const [micLevel, setMicLevel] = useState(0);
  // H5 follow-up: the pre-call mic-test stream / analyser, torn down when the test finishes.
  const micTestStreamRef = useRef<MediaStream | null>(null);
  const micTestCtxRef = useRef<AudioContext | null>(null);
  const micTestRafRef = useRef<number | null>(null);

  // H5 follow-up: release the pre-call mic-test stream + analyser (called when the test ends, on a
  // real call start, and on unmount).
  const stopMicTest = useCallback(() => {
    if (micTestRafRef.current != null) cancelAnimationFrame(micTestRafRef.current);
    micTestRafRef.current = null;
    micTestStreamRef.current?.getTracks().forEach((tr) => tr.stop());
    micTestStreamRef.current = null;
    try {
      void micTestCtxRef.current?.close();
    } catch {
      /* noop */
    }
    micTestCtxRef.current = null;
  }, []);

  // H5 follow-up: sample the mic for ~4s and report whether we heard anything, with a live level bar.
  const testMic = useCallback(async () => {
    stopMicTest();
    setMicTest("testing");
    setMicLevel(0);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      // Not every rejection is a denial: NotFoundError (no microphone at all) and
      // NotReadableError (another app holds the device) need entirely different
      // fixes, and telling that candidate to grant a permission they already
      // granted is the dead end this classifier removes.
      setMicTest(micTestFailure(e));
      return;
    }
    micTestStreamRef.current = stream;
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) {
        setMicTest("heard"); // can't measure — assume ok rather than block the candidate
        stopMicTest();
        return;
      }
      const ctx = new Ctx();
      micTestCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const started = Date.now();
      let peak = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        peak = Math.max(peak, rms);
        setMicLevel(Math.min(1, rms * MIC_LEVEL_GAIN));
        if (Date.now() - started < MIC_TEST_DURATION_MS) {
          micTestRafRef.current = requestAnimationFrame(tick);
        } else {
          setMicTest(peak > MIC_HEARD_RMS ? "heard" : "silent");
          setMicLevel(0);
          stopMicTest();
        }
      };
      micTestRafRef.current = requestAnimationFrame(tick);
    } catch {
      setMicTest("heard");
      stopMicTest();
    }
  }, [stopMicTest]);

  /** What start() runs before dialing: release the test mic before the real call
   *  claims the device, then clear the test verdict. */
  const resetForCall = useCallback(() => {
    stopMicTest();
    setMicTest("idle");
  }, [stopMicTest]);

  return { micTest, micLevel, testMic, stopMicTest, resetForCall };
}
