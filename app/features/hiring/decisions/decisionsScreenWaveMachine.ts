// The screening-wave modal's state machine, extracted pure.
//
// The wave is the one irreversible, email-sending door in the Decisions tab, and
// its lifecycle — debounced preview -> confirm -> commit -> 409 -> re-preview —
// lived entirely inside a React hook: five useStates, a ref, and an effect, with
// nothing asserted anywhere. One of its rules had already been a bug fix
// (40fc5ac3): the 409 notice ("the set changed — review and approve again") is a
// COMMIT-level line, and the re-preview it triggers used to clear it ~350ms
// later, leaving a fresh-looking preview and an unexplained non-event. That rule
// is now a reducer transition with a test, not a comment on a ref.
//
// The reducer owns ORDER and LIFETIME only; the caller owns the network and the
// localization (every `message` here is already resolved through useErrorMessage,
// never a server string).
import type { WaveResult } from "./decisionsScreenWaveTypes";

export interface WaveMachineState {
  preview: WaveResult | null;
  committed: WaveResult | null;
  loading: boolean;
  committing: boolean;
  /** Already-localized. Null = nothing to say. */
  error: string | null;
  confirmOpen: boolean;
  /** Bumped by a conflict to force a fresh preview (and a fresh approval token). */
  refreshNonce: number;
  /** Armed by a 409, consumed by exactly the NEXT preview settle — whichever way
   *  that preview went. This is the invariant the bug fix bought: the notice must
   *  outlive the refresh it triggers, and must never stick to a later one. */
  keepCommitNotice: boolean;
}

export const INITIAL_WAVE_STATE: WaveMachineState = {
  preview: null,
  committed: null,
  loading: true,
  committing: false,
  error: null,
  confirmOpen: false,
  refreshNonce: 0,
  keepCommitNotice: false,
};

export type WaveEvent =
  | { type: "previewStarted" }
  | { type: "previewSucceeded"; result: WaveResult }
  | { type: "previewFailed"; message: string }
  | { type: "previewSettled" }
  | { type: "confirmOpened" }
  | { type: "confirmClosed" }
  | { type: "commitStarted" }
  | { type: "commitSucceeded"; result: WaveResult }
  | { type: "commitConflict"; message: string }
  | { type: "commitFailed"; message: string }
  | { type: "commitSettled" };

export function waveReduce(state: WaveMachineState, event: WaveEvent): WaveMachineState {
  switch (event.type) {
    case "previewStarted":
      return { ...state, loading: true };
    case "previewSucceeded":
      // Never clear a pending commit-level notice here — see keepCommitNotice.
      return { ...state, preview: event.result, error: state.keepCommitNotice ? state.error : null };
    case "previewFailed":
      // The failure replaces the notice: it is the newer, more urgent fact, and the
      // last good preview stays on screen behind it.
      return { ...state, error: event.message };
    case "previewSettled":
      // Consumed on the settle, whichever way it went — one refresh, no more.
      return { ...state, loading: false, keepCommitNotice: false };
    case "confirmOpened":
      return { ...state, confirmOpen: true };
    case "confirmClosed":
      return { ...state, confirmOpen: false };
    case "commitStarted":
      return { ...state, committing: true, error: null };
    case "commitSucceeded":
      return { ...state, committed: event.result, error: null };
    case "commitConflict":
      // The set changed since the preview: say so, and re-preview the CURRENT set
      // so the recruiter approves this one rather than rubber-stamping a stale one.
      return { ...state, error: event.message, keepCommitNotice: true, refreshNonce: state.refreshNonce + 1 };
    case "commitFailed":
      return { ...state, error: event.message };
    case "commitSettled":
      // Close the confirm step whatever happened; the result or the error shows in
      // the main modal.
      return { ...state, committing: false, confirmOpen: false };
    default: {
      // Exhaustiveness: a new event with no transition is a type error, not a
      // silently-ignored state change.
      const never: never = event;
      return never;
    }
  }
}
