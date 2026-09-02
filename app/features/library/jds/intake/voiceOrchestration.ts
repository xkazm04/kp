// Pure state machine for the client half of the two-thread voice design
// (docs/architecture/voice-conversation-plane.md). The component is a thin
// driver; every decision that matters — serialization of fast-turn calls,
// coalescing utterances spoken while a turn is in flight, when the periodic
// extraction thread fires — lives here, dependency-free and unit-tested
// (voiceOrchestration.test.ts).

// The periodic extraction cadence: every N completed exchanges the client
// fires the extraction sweep (voice-complete without turns) so the live brief
// panel fills DURING the call. Lagging the conversation by up to N exchanges
// is honest and by design.
export const EXTRACT_EVERY = 2;

export type OrchestratorState = {
  // A fast-turn request is in flight — new utterances queue instead of racing.
  busy: boolean;
  // Utterances spoken while busy; coalesced into ONE message when dispatched
  // (people finish their thought over several VAD segments).
  queue: string[];
  // Completed exchanges (utterance → spoken reply) this call.
  exchanges: number;
  // The engine closed the session (spoken confirmed read-back) — no more turns.
  ended: boolean;
  // A sweep came due while a turn was going out, and is owed at the next idle
  // moment. The two threads used to be fired from the same `finally` block —
  // `if (extract) void sweep(); if (next) void dispatch(next);` — so a batch
  // extraction ran concurrently with a paid fast turn, each spending on the
  // other's shoulder and racing over the same row. (The STORE is what makes
  // that race safe now — updateIntakeVoiceSweep re-reads the transcript inside
  // its write — because the client cannot serialize an utterance the requestor
  // simply speaks mid-sweep. This only removes the self-inflicted overlap.)
  pendingExtract: boolean;
};

export const initialOrchestratorState: OrchestratorState = {
  busy: false,
  queue: [],
  exchanges: 0,
  ended: false,
  pendingExtract: false,
};

/** A transcribed utterance arrived. Returns the message to dispatch NOW (when
 *  idle) or null (queued behind the in-flight turn / session ended). */
export function enqueueUtterance(state: OrchestratorState, text: string): { state: OrchestratorState; dispatch: string | null } {
  const trimmed = text.trim();
  if (!trimmed || state.ended) return { state, dispatch: null };
  if (state.busy) {
    return { state: { ...state, queue: [...state.queue, trimmed] }, dispatch: null };
  }
  // Idle WITH a queue means a previous turn failed and its words were put back
  // (see completeTurn) — they go out WITH this utterance, in the order spoken,
  // so a refused turn can never leave speech stranded in the queue.
  const dispatch = [...state.queue, trimmed].join(" ");
  return { state: { ...state, queue: [], busy: true }, dispatch };
}

/** The in-flight fast turn finished (or failed — pass done:false then). Returns
 *  the next coalesced message to dispatch (utterances that queued meanwhile)
 *  and whether the periodic extraction thread should fire now.
 *
 *  `failed` = the utterance whose POST did NOT land (a refused/blipped
 *  /voice-turn). Only a DELIVERED utterance is persisted server-side, so a
 *  dropped one exists nowhere: the requestor stated a dealbreaker, saw a small
 *  "failed" note, kept talking, and the sentence was in no transcript and no
 *  brief. Put it back at the FRONT of the queue instead — the next utterance
 *  carries it along (enqueueUtterance coalesces), and a hang-up recovers it
 *  with the rest of the queue. Deliberately NOT re-dispatched on its own: a
 *  rate-limited turn must not become a retry loop against a paid endpoint. */
export function completeTurn(
  state: OrchestratorState,
  done: boolean,
  failed?: string | null
): { state: OrchestratorState; next: string | null; extract: boolean } {
  const exchanges = state.exchanges + 1;
  const ended = state.ended || done;
  const lost = failed?.trim() ?? "";
  const pending = lost ? [lost, ...state.queue] : state.queue;
  // Due now, or owed from a cadence tick that was deferred behind a dispatch.
  // Every completed exchange adds turns, so a due sweep always has something new
  // to read — the only sweep that can be redundant is the one `finish()` posts
  // after a close, and that one is the hang-up RECOVERY post, not this cadence.
  const due = ended || exchanges % EXTRACT_EVERY === 0 || state.pendingExtract;
  // A close keeps `pending` rather than clearing it: nothing more may be
  // dispatched, but the hang-up recovery (finish → /voice-complete `turns`) is
  // the last chance for words that never reached the server.
  if (ended || lost || pending.length === 0) {
    return {
      state: { busy: false, queue: pending, exchanges, ended, pendingExtract: false },
      next: null,
      extract: due,
    };
  }
  // A turn is going out RIGHT NOW: the sweep waits for the next idle moment
  // rather than running beside it.
  const next = pending.join(" ");
  return {
    state: { busy: true, queue: [], exchanges, ended, pendingExtract: due },
    next,
    extract: false,
  };
}

/** What the agent should SAY when the call opens: the pending question from the
 *  text thread (the last agent turn), so voice continues the same conversation
 *  instead of restarting it. Null on a virgin transcript (shouldn't happen —
 *  sessions always open with the deterministic text opener). */
export function spokenOpener(transcript: { role: string; text: string }[]): string | null {
  for (let i = transcript.length - 1; i >= 0; i--) {
    if (transcript[i].role === "interviewer" && transcript[i].text.trim()) return transcript[i].text.trim();
  }
  return null;
}
