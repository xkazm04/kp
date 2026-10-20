// What the candidate's eye lands on during the call: ONE state, derived once.
//
// The status pill, the presence orb and the screen-reader announcement were three
// places that each re-derived "is the interviewer talking" from a different pair of
// booleans, so they could disagree inside the same frame. This is the single
// derivation; it is pure, so the whole table is a test rather than three components'
// worth of trust.

import type { Phase } from "./ui-types";

export type PresenceState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "ended";

export type PresenceInput = {
  phase: Phase;
  /** The interviewer's audio is playing (OpenAI analyser / ElevenLabs mode). */
  interviewerSpeaking: boolean;
  /** The model is generating but has not started speaking yet. */
  thinking: boolean;
};

/** The one derivation. `ending` is NOT collapsed to "ended": the interviewer's closing
 *  line is usually still playing when the wrap-up starts, and showing a dead orb while
 *  a voice is still talking is the kind of small lie that makes a product feel broken. */
export function presenceState({ phase, interviewerSpeaking, thinking }: PresenceInput): PresenceState {
  switch (phase) {
    case "idle":
      return "idle";
    case "connecting":
      return "connecting";
    case "live":
      if (interviewerSpeaking) return "speaking";
      return thinking ? "thinking" : "listening";
    case "ending":
      return interviewerSpeaking ? "speaking" : "ended";
    case "ended":
    case "error":
      return "ended";
  }
}

/** Whether this state is driven by a live audio level (so the orb should follow the
 *  meter) — the others are static by nature and must not jitter. */
export function presenceIsLive(state: PresenceState): boolean {
  return state === "listening" || state === "speaking";
}

/** Which meter feeds the orb: the candidate's microphone while we listen, the
 *  interviewer's audio while it speaks, neither otherwise. */
export function presenceMeter(state: PresenceState): "input" | "output" | null {
  if (state === "listening") return "input";
  if (state === "speaking") return "output";
  return null;
}
