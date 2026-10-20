// ONE contract for a live voice call, whichever engine carries it.
//
// The call shell (VoiceInterview.tsx) used to branch on the provider's NAME for every
// live-call decision — directive injection, the closing-answer grace, mic mute, output
// mute, unmount teardown, the end handshake — and parity drifted without anyone seeing
// it: the presence orb's level box was written only by the OpenAI meters, so on an
// ElevenLabs call the orb stayed flat for the whole interview. The shell now holds one
// CallTransport and asks what it CAN do (its declared capabilities), never which one it
// is. The only provider-keyed line left in the shell is the start() dispatch that
// chooses the transport: opening a session takes engine-specific inputs by design.
//
// Node-importable on purpose, so the contract has node:test coverage: the ElevenLabs
// adapter takes the SDK session STRUCTURALLY (transport/elevenlabs.ts imports
// @elevenlabs/react and cannot load under node), and the OpenAI adapter wraps the
// existing ref-driven functions of transport/openai.ts without changing them.

import { sendDirective, teardownOpenAi, type OaiCues, type OaiRefs, type VoiceLevels } from "./openai";

// How long an OpenAI call's finalize waits for a candidate utterance whose
// transcription is still in flight when the call ends (idea-b70b8bd7). Whisper
// turnaround for a short closing answer is well under this; past it finalize falls
// back to whatever streamed into the delta buffer rather than hanging "Ending…". Held
// at 3s — the same bound as EL_DISCONNECT_GRACE_MS — so both engines give the
// candidate's closing answer the same headroom before the transcript is snapshotted.
export const OAI_FINAL_TURN_GRACE_MS = 3000;

// How long end() waits for ElevenLabs onDisconnect to drive finalize before finalizing
// itself. The SDK delivers the candidate's final utterance via onMessage a few hundred
// ms AFTER endSession(), then closes (onDisconnect), so deferring to onDisconnect
// captures that closing turn; the timer is the fallback if onDisconnect never lands.
export const EL_DISCONNECT_GRACE_MS = 3000;

/** How a transport's call ends, and how the presence orb learns its levels.
 *
 *  - `finalizeOn: "disconnect"` — ending is a request: the engine delivers late turns
 *    and then reports its own close, which drives finalize; `closeGraceMs` bounds the
 *    wait for that close.
 *  - `finalizeOn: "immediate"` — the shell finalizes as soon as End is decided, holding
 *    for at most `pendingTurnGraceMs` when a candidate utterance is mid-transcription.
 *  - `levels: "pushed"` — the transport's own meters write the level box;
 *    `"sampled"` — the shell polls `sampleLevels` on an animation frame while live. */
export type CallCapabilities =
  | { finalizeOn: "disconnect"; closeGraceMs: number; levels: "pushed" | "sampled" }
  | { finalizeOn: "immediate"; pendingTurnGraceMs: number; levels: "pushed" | "sampled" };

/** The live call, as the shell sees it. Every method is total: a transport that is not
 *  ready answers `false` (or does nothing) rather than throwing into a click handler. */
export type CallTransport = {
  /** The stable object this transport drives. The ElevenLabs SDK's callbacks belong to
   *  the current call only while the serving transport's handle IS the SDK session. */
  readonly handle: object;
  readonly capabilities: CallCapabilities;
  /** Mute / unmute the candidate's microphone. True when the engine accepted it. */
  setMicMuted(muted: boolean): boolean;
  /** Mute / unmute the interviewer's voice. True when the engine accepted it. */
  setOutputMuted(muted: boolean): boolean;
  /** Stop capturing the microphone WITHOUT closing the channel, so a closing answer
   *  already spoken can still be transcribed and delivered. */
  stopCapture(): void;
  /** Inject ONE director stage direction, verbatim. False when it could not be sent. */
  injectDirective(text: string): boolean;
  /** Write the current input/output levels (0..1) into the presence box. Never throws. */
  sampleLevels(box: { current: VoiceLevels }): void;
  /** Close the call's channel. Idempotent: a second call sends nothing. */
  end(): void;
};

/** What planEnd reads besides the capability: whether a candidate utterance is still
 *  being transcribed, and whether the channel it would arrive on is still open. */
export type EndState = { pendingCandidate: boolean; channelOpen: boolean };

/** The end handshake. `endSessionThenWaitMs`: ask the engine to close and let its
 *  close drive finalize, finalizing yourself after the grace. `stopCaptureThenWaitMs`:
 *  stop the mic, wait for the pending closing answer. `{}`: finalize now. */
export type EndPlan = { endSessionThenWaitMs?: number; stopCaptureThenWaitMs?: number };

export function planEnd(capabilities: CallCapabilities | null | undefined, state: EndState): EndPlan {
  if (!capabilities) return {};
  if (capabilities.finalizeOn === "disconnect") return { endSessionThenWaitMs: capabilities.closeGraceMs };
  if (state.pendingCandidate && state.channelOpen) return { stopCaptureThenWaitMs: capabilities.pendingTurnGraceMs };
  return {};
}

function clampLevel(read: () => number): number {
  try {
    const v = read();
    if (!Number.isFinite(v)) return 0;
    return Math.min(1, Math.max(0, v));
  } catch {
    // best-effort: a meter the SDK cannot read right now is a still ring, not an error
    return 0;
  }
}

// ── ElevenLabs ─────────────────────────────────────────────────────────────────

/** The slice of the @elevenlabs/react conversation the call needs, structurally. */
export type ElevenLabsSessionLike = {
  setMuted: (muted: boolean) => void;
  setVolume: (options: { volume: number }) => void;
  sendContextualUpdate: (text: string) => void;
  endSession: () => void;
  getInputVolume: () => number;
  getOutputVolume: () => number;
};

/** A STABLE session over a ref to the SDK object. The hook's return value is rebuilt
 *  every render; this forwards each call to whatever the ref holds at call time and
 *  throws while it holds nothing, which the adapter turns into `false`. */
export function sessionFromRef(ref: { current: ElevenLabsSessionLike | null }): ElevenLabsSessionLike {
  const conv = (): ElevenLabsSessionLike => {
    const c = ref.current;
    if (!c) throw new Error("the ElevenLabs session is not ready");
    return c;
  };
  return {
    setMuted: (muted) => conv().setMuted(muted),
    setVolume: (options) => conv().setVolume(options),
    sendContextualUpdate: (text) => conv().sendContextualUpdate(text),
    endSession: () => conv().endSession(),
    getInputVolume: () => conv().getInputVolume(),
    getOutputVolume: () => conv().getOutputVolume(),
  };
}

export function elevenLabsCallTransport(conv: ElevenLabsSessionLike): CallTransport {
  let ended = false;
  return {
    handle: conv,
    capabilities: { finalizeOn: "disconnect", closeGraceMs: EL_DISCONNECT_GRACE_MS, levels: "sampled" },
    setMicMuted(muted) {
      try {
        conv.setMuted(muted);
        return true;
      } catch {
        // SDK not ready — the shell's state still reflects the candidate's intent
        return false;
      }
    },
    setOutputMuted(muted) {
      try {
        // ElevenLabs renders audio internally, so output mute is the SDK volume.
        conv.setVolume({ volume: muted ? 0 : 1 });
        return true;
      } catch {
        // SDK not ready — the shell's state still reflects the candidate's intent
        return false;
      }
    },
    stopCapture() {
      try {
        conv.setMuted(true);
      } catch {
        // best-effort: the session is closing anyway
      }
    },
    // `sendContextualUpdate` is the SDK's channel for exactly this: text the agent
    // READS as context for its next turn rather than as something the candidate said,
    // and it does not force a reply (the parity with OpenAI's system message + no
    // `response.create`).
    injectDirective(text) {
      if (!text.trim()) return false;
      try {
        conv.sendContextualUpdate(text);
        return true;
      } catch (err) {
        // A direction that cannot be delivered is a call that keeps running
        // undirected, which is the documented degrade — but an operator should see why.
        console.error("[voice] ElevenLabs contextual update failed:", err);
        return false;
      }
    },
    // The SDK exposes its own input/output volume; nothing pushes them, so the shell
    // samples on the orb's frame. This is the write the orb never had on ElevenLabs.
    sampleLevels(box) {
      box.current = {
        input: clampLevel(() => conv.getInputVolume()),
        output: clampLevel(() => conv.getOutputVolume()),
      };
    },
    end() {
      if (ended) return;
      ended = true;
      try {
        conv.endSession();
      } catch {
        // noop: the SDK has nothing left to close
      }
    },
  };
}

// ── OpenAI Realtime (raw WebRTC) ────────────────────────────────────────────────

const NO_CUES: OaiCues = { setSpeaking: () => {}, setUnstable: () => {}, setAudioBlocked: () => {} };

export function openAiCallTransport(refs: OaiRefs, cues: OaiCues = NO_CUES): CallTransport {
  return {
    handle: refs,
    capabilities: { finalizeOn: "immediate", pendingTurnGraceMs: OAI_FINAL_TURN_GRACE_MS, levels: "pushed" },
    setMicMuted(muted) {
      const mic = refs.mic.current;
      if (!mic) return false;
      mic.getAudioTracks().forEach((tr) => (tr.enabled = !muted));
      return true;
    },
    setOutputMuted(muted) {
      // OpenAI plays through the shell's hidden <audio> element.
      const el = refs.audio.current;
      if (!el) return false;
      el.muted = muted;
      return true;
    },
    // Stop capture (so server VAD sees end-of-speech and transcribes what it heard)
    // but keep the data channel open to receive that closing answer.
    stopCapture() {
      refs.mic.current?.getTracks().forEach((tr) => tr.stop());
    },
    injectDirective: (text) => sendDirective(refs, text),
    // The two analysers in transport/openai.ts write the box themselves.
    sampleLevels() {},
    // teardownOpenAi nulls every handle it closes, so a second end() finds nothing.
    end: () => teardownOpenAi(refs, cues),
  };
}
