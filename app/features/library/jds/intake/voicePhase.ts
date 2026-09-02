// Pure UI state machine for the intake voice plane — the sibling of
// voiceOrchestration.ts (which owns the CONVERSATION: serialization, queueing,
// extraction cadence). This module owns what the requestor SEES: which phase the
// call is in, and — the part that was missing — WHICH failure happened.
//
// Before this existed the whole voice plane resolved every failure into one
// boolean and one "the call didn't go through" line, while the text plane beside
// it resolved every refusal by code. A browser microphone denial (the single most
// common real failure of a voice screen, and the only one the requestor can fix)
// read exactly like a provider outage, with no "allow the microphone" path.
//
// The phase machine also lives here rather than in the component because two of
// its transitions are races, not sequences: the transport's `setLive` can land
// AFTER a hang-up already moved the surface to "processing" (close-during-
// processing), and `setAwaitingMic(false)` fires from a `finally` that runs after
// an unmount. Both are one-line rules here and were untestable in the .tsx.

import { micErrorText } from "@/app/_components/voice/micErrorText";

/** How long the closing line is allowed to play before the call hangs up.
 *  Named (and cancellable — see scheduleHangUp) because it outlives the turn
 *  that scheduled it: a bare window.setTimeout survived unmount and hung up a
 *  session the requestor had already navigated away from. */
export const HANGUP_DELAY_MS = 6_000;

export type VoicePhase = "idle" | "connecting" | "live" | "processing";

/** The three getUserMedia outcomes the requestor can act on, classified by the
 *  shared micErrorText (one classifier for both voice surfaces). */
export type MicReason = "denied" | "notFound" | "busy";

/** What went wrong, in a shape the UI can render honestly. `api` carries the
 *  route's machine code — the client resolves it through useErrorMessage in the
 *  reader's language and never renders the server's English string. */
export type VoiceFailure =
  | { kind: "api"; code: string | null; status: number }
  | { kind: "mic"; reason: MicReason }
  | { kind: "transport" };

export type VoiceUiState = {
  phase: VoicePhase;
  failure: VoiceFailure | null;
  /** The browser's microphone prompt is open — the call is waiting on a human. */
  awaitingMic: boolean;
  /** Autoplay was refused: the agent is speaking into a muted element. */
  audioBlocked: boolean;
};

export const initialVoiceUiState: VoiceUiState = {
  phase: "idle",
  failure: null,
  awaitingMic: false,
  audioBlocked: false,
};

export type VoiceEvent =
  | { type: "start" }
  | { type: "live" }
  | { type: "awaitingMic"; value: boolean }
  | { type: "audioBlocked"; value: boolean }
  /** Terminal: the call never came up (mint refused, mic denied, dial failed). */
  | { type: "connectFailed"; failure: VoiceFailure }
  /** Non-terminal: one utterance did not land; the call keeps going and the
   *  orchestrator puts the words back in the queue. */
  | { type: "turnFailed"; failure: VoiceFailure }
  /** Hang-up began — the transcript write-up is in flight. */
  | { type: "finishing" }
  | { type: "finished"; failure?: VoiceFailure | null };

export function voiceUiReducer(state: VoiceUiState, event: VoiceEvent): VoiceUiState {
  switch (event.type) {
    case "start":
      // A second start while a call is up is a no-op, not a reset.
      if (state.phase !== "idle") return state;
      return { phase: "connecting", failure: null, awaitingMic: false, audioBlocked: false };
    case "live":
      // ONLY from connecting: the transport marks live after the SDP exchange,
      // which can resolve after a hang-up or an unmount already closed the
      // surface. Accepting it there would show "End call" over a dead call.
      if (state.phase !== "connecting") return state;
      return { ...state, phase: "live", awaitingMic: false };
    case "awaitingMic":
      // The prompt hint is only meaningful while a connect is in flight.
      return { ...state, awaitingMic: event.value && state.phase === "connecting" };
    case "audioBlocked":
      return { ...state, audioBlocked: event.value && state.phase !== "idle" };
    case "connectFailed":
      return { phase: "idle", failure: event.failure, awaitingMic: false, audioBlocked: false };
    case "turnFailed":
      return { ...state, failure: event.failure };
    case "finishing":
      if (state.phase === "idle") return state;
      return { ...state, phase: "processing", awaitingMic: false, audioBlocked: false };
    case "finished":
      return {
        phase: "idle",
        failure: event.failure ?? state.failure,
        awaitingMic: false,
        audioBlocked: false,
      };
  }
}

/** A non-ok API response → the failure the UI renders. The `code` half is the
 *  only half that reaches the reader (api-contracts.md §1.1). */
export function apiFailure(status: number, body: unknown): VoiceFailure {
  const code =
    body && typeof body === "object" && typeof (body as { code?: unknown }).code === "string"
      ? (body as { code: string }).code
      : null;
  return { kind: "api", code, status };
}

/** A thrown transport/getUserMedia error → a mic failure the requestor can fix,
 *  or a plain transport fault. The classification is micErrorText's (shared with
 *  the candidate voice interview) — passing the reasons as its copy strings keeps
 *  exactly one table of DOMException names in the repo. */
export function micFailure(error: unknown): VoiceFailure {
  const reason = micErrorText(error, { denied: "denied", notFound: "notFound", busy: "busy" }) as MicReason | null;
  return reason ? { kind: "mic", reason } : { kind: "transport" };
}

/** What the availability probe learned.
 *  - `unconfigured` — the install answered, honestly, that voice has no provider.
 *  - `unknown` — the probe itself did not land (a 429, a blip, an offline tab).
 *    Claiming "voice isn't configured on this server" from THAT is a lie about
 *    the install, so it gets its own re-checkable line instead. */
export type VoiceAvailability = "checking" | "ready" | "unconfigured" | "unknown";

export function readAvailability(ok: boolean, body: unknown): VoiceAvailability {
  if (!ok) return "unknown";
  const availability = (body as { availability?: { openai?: unknown } } | null)?.availability;
  return availability?.openai === true ? "ready" : "unconfigured";
}

/** The timer seam, so the delay can be driven by a test without fake globals. */
export type HangUpTimers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

/** Schedule the post-close hang-up and hand back its cancel. The component keeps
 *  the cancel in a ref and calls it on unmount: the timer used to be a bare
 *  window.setTimeout that nothing owned, so a requestor who closed the session
 *  during the closing line got a hang-up (and its transcript POST) fired from a
 *  component that no longer existed. Idempotent — an explicit close and the
 *  unmount effect can both cancel. */
export function scheduleHangUp(run: () => void, timers: HangUpTimers, delayMs: number = HANGUP_DELAY_MS): () => void {
  const handle = timers.set(run, delayMs);
  let cancelled = false;
  return () => {
    if (cancelled) return;
    cancelled = true;
    timers.clear(handle);
  };
}
