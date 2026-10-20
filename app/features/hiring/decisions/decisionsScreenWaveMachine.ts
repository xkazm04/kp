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
import type { ScreenWaveRefusalReason } from "@/app/_lib/screen-wave-contract";
import type { WaveResult } from "./decisionsScreenWaveTypes";

/** What each approval refusal (the 409's `reason`) does to the modal. The five ask
 *  the recruiter for different things, and folding them into one "re-preview" loops
 *  on `unattributed` (no re-preview names an approver: it re-arms a commit that must
 *  fail again) and mis-narrates `spent` (a retried commit whose first attempt DID
 *  land: the queue behind the modal still lists people already rejected).
 *  - repreview: bump the nonce so the recruiter approves the CURRENT set, keeping
 *    the notice alive across that one refresh (the 40fc5ac3 rule).
 *  - blocked: disable Commit for this modal's life; nothing the recruiter does in
 *    it can clear the refusal.
 *  - landedElsewhere: the wave committed; the hook reloads the queue.
 *  Typed as a total Record, so a new refusal reason is a type error here. */
export const REFUSAL_EFFECT: Record<ScreenWaveRefusalReason, { repreview: boolean; blocked: boolean; landedElsewhere: boolean }> = {
  required: { repreview: true, blocked: false, landedElsewhere: false },
  expired: { repreview: true, blocked: false, landedElsewhere: false },
  mismatch: { repreview: true, blocked: false, landedElsewhere: false },
  spent: { repreview: true, blocked: false, landedElsewhere: true },
  unattributed: { repreview: false, blocked: true, landedElsewhere: false },
};

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
  /** Set by a refusal no re-preview can fix (REFUSAL_EFFECT.blocked): Commit stays
   *  disabled with `blockedMessage` as its stated reason. Never cleared by a preview. */
  commitBlocked: ScreenWaveRefusalReason | null;
  /** Already-localized sentence for `commitBlocked`. */
  blockedMessage: string | null;
  /** Armed by a refusal whose wave DID land (`spent`; the hook reloads the queue on
   *  that same refusal), consumed by the next preview settle. */
  landedElsewhere: boolean;
  /** The reviewer's exclusions (screen-wave-spare.ts), sorted: the entry ids the NEXT
   *  preview asks the server to take out of the wave. Survives every re-preview. */
  spared: readonly string[];
  /** The exclusions the DISPLAYED preview was computed with, so its token and the list
   *  a commit echoes always belong together (the server re-derives the signed set from
   *  the echoed list; a differing one is a "mismatch"). */
  previewSpare: readonly string[];
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
  commitBlocked: null,
  blockedMessage: null,
  landedElsewhere: false,
  spared: [],
  previewSpare: [],
};

export type WaveEvent =
  | { type: "previewStarted" }
  | { type: "previewSucceeded"; result: WaveResult; spare?: readonly string[] }
  | { type: "previewFailed"; message: string }
  | { type: "previewSettled" }
  | { type: "confirmOpened" }
  | { type: "confirmClosed" }
  | { type: "commitStarted" }
  | { type: "commitSucceeded"; result: WaveResult }
  | { type: "commitRefused"; reason: ScreenWaveRefusalReason; message: string }
  | { type: "commitFailed"; message: string }
  | { type: "commitSettled" }
  | { type: "spareToggled"; entryId: string };

export function waveReduce(state: WaveMachineState, event: WaveEvent): WaveMachineState {
  switch (event.type) {
    case "previewStarted":
      return { ...state, loading: true };
    case "previewSucceeded":
      // Never clear a pending commit-level notice here — see keepCommitNotice.
      return { ...state, preview: event.result, previewSpare: event.spare ?? [], error: state.keepCommitNotice ? state.error : null };
    case "previewFailed":
      // The failure replaces the notice: it is the newer, more urgent fact, and the
      // last good preview stays on screen behind it.
      return { ...state, error: event.message };
    case "previewSettled":
      // Consumed on the settle, whichever way it went — one refresh, no more.
      return { ...state, loading: false, keepCommitNotice: false, landedElsewhere: false };
    case "confirmOpened":
      return { ...state, confirmOpen: true };
    case "confirmClosed":
      return { ...state, confirmOpen: false };
    case "commitStarted":
      return { ...state, committing: true, error: null };
    case "commitSucceeded":
      return { ...state, committed: event.result, error: null };
    case "commitRefused": {
      const effect = REFUSAL_EFFECT[event.reason];
      if (effect.blocked) {
        return { ...state, error: event.message, commitBlocked: event.reason, blockedMessage: event.message };
      }
      // The set changed / the review aged / it was already spent: say so, and
      // re-preview the CURRENT set so the recruiter approves this one rather than
      // rubber-stamping a stale one.
      return {
        ...state,
        error: event.message,
        keepCommitNotice: true,
        refreshNonce: effect.repreview ? state.refreshNonce + 1 : state.refreshNonce,
        landedElsewhere: effect.landedElsewhere || state.landedElsewhere,
      };
    }
    case "commitFailed":
      return { ...state, error: event.message };
    case "commitSettled":
      // Close the confirm step whatever happened; the result or the error shows in
      // the main modal.
      return { ...state, committing: false, confirmOpen: false };
    case "spareToggled": {
      // The committed view is frozen: sparing after the fact is the reconsider queue's
      // job, not this modal's.
      if (state.committed) return state;
      const next = state.spared.includes(event.entryId)
        ? state.spared.filter((id) => id !== event.entryId)
        : [...state.spared, event.entryId].sort();
      // A new exclusion is a new set to approve: re-preview for a fresh token.
      return { ...state, spared: next, refreshNonce: state.refreshNonce + 1 };
    }
    default: {
      // Exhaustiveness: a new event with no transition is a type error, not a
      // silently-ignored state change.
      const never: never = event;
      return never;
    }
  }
}
