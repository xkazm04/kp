// The director EXCHANGE, in memory (spark interview-uat-tranche, WP-1).
//
// The simulator runs the SAME exchange the live route runs — voice/director-exchange.ts
// `directorExchange`, the kernel behind voice/director-step.ts `runDirectorStep` — over
// an array instead of the interview_events table. Only the store differs, and it holds
// the table's rules in memory:
//
//   - a turn already recorded for its (attempt, seq) is absorbed, not doubled (the
//     table's ON CONFLICT index), and ackSeq is the highest recorded turn seq;
//   - rows land in record order with the simulated clock as their record time.
//
// Not carried over, because a simulated call cannot reach them: the per-session event
// ceiling (MAX_INTERVIEW_EVENTS_PER_SESSION = 4000; the store always accepts) and the
// session's activity stamp (there is no session row). A turn is clamped exactly like
// production (interview-transcript.ts clampTurn) before it reaches the kernel.

import {
  deriveDirectorState,
  type DirectorEvent,
  type DirectorState,
  type DirectorToolCallInput,
  type DirectorToolOutcome,
} from "../voice/director";
import { directorExchange, type DirectorEventRow, type DirectorEventStore } from "../voice/director-exchange";
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
  private readonly store: DirectorEventStore;

  constructor(
    readonly agenda: InterviewAgenda | null,
    /** When the call connected (production: the session's updated_at at /connect). */
    readonly attemptStartedAtMs: number,
  ) {
    const events = this.events;
    const recorded = (seq: number) => events.some((e) => e.kind === "turn" && e.attempt === SIM_ATTEMPT && e.seq === seq);
    this.store = {
      events: () => [...events],
      canStore: () => true,
      append(rows: readonly DirectorEventRow[], nowMs: number): DirectorEvent[] {
        const createdAt = new Date(nowMs).toISOString();
        const written: DirectorEvent[] = [];
        for (const r of rows) {
          const seq = r.kind === "turn" ? (r.seq ?? null) : null;
          if (r.kind === "turn" && (seq === null || recorded(seq))) continue;
          const row: DirectorEvent = { kind: r.kind, attempt: SIM_ATTEMPT, seq, blockId: r.blockId, payload: r.payload, createdAt };
          events.push(row);
          written.push(row);
        }
        return written;
      },
      maxTurnSeq: () =>
        events.reduce((m, e) => (e.kind === "turn" && e.attempt === SIM_ATTEMPT && typeof e.seq === "number" ? Math.max(m, e.seq) : m), -1),
    };
  }

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

  /** One exchange — the kernel's order (voice/director-exchange.ts). */
  exchange(input: { turns: readonly SimDirectorTurn[]; tool: DirectorToolCallInput | null; nowMs: number }): SimExchangeResult {
    const turns = input.turns.map((t) => {
      const { turn } = clampTurn({ role: t.role, text: t.text });
      return { seq: t.seq, role: turn.role, text: turn.text, at: "" };
    });
    const { response, outcome, state } = directorExchange({
      agenda: this.agenda,
      attempt: SIM_ATTEMPT,
      attemptStartedAtMs: this.attemptStartedAtMs,
      nowMs: input.nowMs,
      turns,
      clientEvents: [],
      tool: input.tool,
      store: this.store,
    });
    return { ...response, outcome, state };
  }
}
