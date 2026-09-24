// The director EXCHANGE, in memory (spark interview-uat-tranche, WP-1).
//
// A line-for-line mirror of voice/director-step.ts `runDirectorStep` with the
// interview_events table replaced by an array. The ORDER is the thing being mirrored,
// because it decides what the director sees:
//
//   1. persist the exchange's turns, each TAGGED with the block that was active BEFORE
//      this exchange's tool (clamped exactly like production: interview-transcript.ts
//      clampTurn);
//   2. apply AT MOST ONE tool call — the REAL applyDirectorTool, against the state
//      derived from the record so far and the candidate's persisted words — and
//      persist the events it asks for;
//   3. re-derive the state, decide AT MOST ONE stage direction — the REAL
//      decideDirective — and persist it, so its dedupe window holds across exchanges;
//   4. answer the way production answers: the tool result, the directive, and
//      `endCall = outcome.endCall || state.endRequested || overTime`, with overTime
//      read against the SAME endCeilingMin the director's `end_now` uses, from the
//      state as it stood BEFORE the directive was appended (as production does).
//
// director-step.ts is not imported for the exchange itself because it IS the database
// transaction; the policy it calls is imported unchanged. What the mirror leaves out,
// on purpose: the per-session event ceiling (MAX_INTERVIEW_EVENTS_PER_SESSION = 4000 —
// no simulated call comes near it), the activity stamp, and resent-turn idempotency
// (the simulator never resends). A source test (engine.test.ts) pins director-step's
// order so this mirror goes red, not stale, if production reorders.

import {
  applyDirectorTool,
  decideDirective,
  deriveDirectorState,
  directorAgendaState,
  endCeilingMin,
  type DirectorEvent,
  type DirectorEventDraft,
  type DirectorState,
  type DirectorToolCallInput,
  type DirectorToolOutcome,
} from "../voice/director";
import { clampTurn } from "../interview-transcript";
import type { DirectorResponse, InterviewAgenda } from "../voice/director-types";

/** The one attempt a simulated call runs (no drops, no reconnects). */
export const SIM_ATTEMPT = 1;

export type SimDirectorTurn = { seq: number; role: "candidate" | "interviewer"; text: string };

export type SimExchangeResult = DirectorResponse & {
  /** The REAL tool outcome (events included), or null when no tool was sent. */
  outcome: DirectorToolOutcome | null;
  /** The state the directive was decided from. */
  state: DirectorState;
};

/** One simulated call's director record: the interview_events rows production would
 *  hold, in record order, and the exchange that appends to them. */
export class InMemoryDirector {
  readonly events: DirectorEvent[] = [];

  constructor(
    readonly agenda: InterviewAgenda | null,
    /** When the call connected (production: the session's updated_at at /connect). */
    readonly attemptStartedAtMs: number,
  ) {}

  /** The state as the director would derive it at `nowMs`. */
  stateAt(nowMs: number): DirectorState {
    return deriveDirectorState({
      agenda: this.agenda,
      events: this.events,
      currentAttempt: SIM_ATTEMPT,
      attemptStartedAtMs: this.attemptStartedAtMs,
      nowMs,
    });
  }

  private append(drafts: readonly DirectorEventDraft[], nowMs: number, seq: number | null = null): void {
    const createdAt = new Date(nowMs).toISOString();
    for (const d of drafts) {
      this.events.push({ kind: d.kind, attempt: SIM_ATTEMPT, seq, blockId: d.blockId, payload: d.payload, createdAt });
    }
  }

  private candidateTurnTexts(): string[] {
    return this.events
      .filter((e) => e.kind === "turn" && e.payload.role === "candidate" && typeof e.payload.text === "string")
      .map((e) => e.payload.text as string);
  }

  /** One exchange — see the header for the order. */
  exchange(input: { turns: readonly SimDirectorTurn[]; tool: DirectorToolCallInput | null; nowMs: number }): SimExchangeResult {
    const { nowMs } = input;
    const agenda = this.agenda;
    const before = this.stateAt(nowMs);

    // 1. Persist the turns, tagged with the block that was active before this exchange.
    for (const t of input.turns) {
      const { turn } = clampTurn({ role: t.role, text: t.text });
      const createdAt = new Date(nowMs).toISOString();
      this.events.push({
        kind: "turn",
        attempt: SIM_ATTEMPT,
        seq: t.seq,
        blockId: before.activeBlockId,
        payload: { role: turn.role, text: turn.text },
        createdAt,
      });
    }

    // 2. At most one tool call.
    let outcome: DirectorToolOutcome | null = null;
    if (input.tool) {
      outcome = applyDirectorTool({
        tool: input.tool,
        agenda,
        state: this.stateAt(nowMs),
        candidateTurnTexts: this.candidateTurnTexts(),
      });
      this.append(outcome.events, nowMs);
    }

    // 3. At most one stage direction, recorded so its dedupe outlives this exchange.
    const state = this.stateAt(nowMs);
    const directive = decideDirective({ agenda, state, currentAttempt: SIM_ATTEMPT, nowMs });
    if (directive) {
      this.append(
        [{ kind: "directive", blockId: directive.blockId, payload: { directiveId: directive.id, kind: directive.kind, text: directive.text } }],
        nowMs,
      );
    }

    // 4. The answer — the same ceiling end_now fires at.
    const overTime = agenda !== null && state.elapsedMs >= endCeilingMin(agenda, state) * 60_000;
    const turnSeqs = this.events.filter((e) => e.kind === "turn" && typeof e.seq === "number").map((e) => e.seq as number);
    return {
      ok: true,
      ackSeq: turnSeqs.length ? Math.max(...turnSeqs) : -1,
      toolResult: outcome ? outcome.toolResult : null,
      directive,
      agenda: directorAgendaState(state),
      endCall: Boolean(outcome?.endCall) || state.endRequested || overTime,
      clock: agenda !== null ? { elapsedMs: state.elapsedMs, endLimitMs: endCeilingMin(agenda, state) * 60_000 } : null,
      outcome,
      state,
    };
  }
}
