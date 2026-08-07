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
};

export const initialOrchestratorState: OrchestratorState = { busy: false, queue: [], exchanges: 0, ended: false };

/** A transcribed utterance arrived. Returns the message to dispatch NOW (when
 *  idle) or null (queued behind the in-flight turn / session ended). */
export function enqueueUtterance(state: OrchestratorState, text: string): { state: OrchestratorState; dispatch: string | null } {
  const trimmed = text.trim();
  if (!trimmed || state.ended) return { state, dispatch: null };
  if (state.busy) {
    return { state: { ...state, queue: [...state.queue, trimmed] }, dispatch: null };
  }
  return { state: { ...state, busy: true }, dispatch: trimmed };
}

/** The in-flight fast turn finished (or failed — pass done:false then). Returns
 *  the next coalesced message to dispatch (utterances that queued meanwhile)
 *  and whether the periodic extraction thread should fire now. */
export function completeTurn(state: OrchestratorState, done: boolean): { state: OrchestratorState; next: string | null; extract: boolean } {
  const exchanges = state.exchanges + 1;
  const ended = state.ended || done;
  const extract = ended || exchanges % EXTRACT_EVERY === 0;
  if (ended || state.queue.length === 0) {
    return { state: { busy: false, queue: [], exchanges, ended }, next: null, extract };
  }
  const next = state.queue.join(" ");
  return { state: { busy: true, queue: [], exchanges, ended }, next, extract };
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
