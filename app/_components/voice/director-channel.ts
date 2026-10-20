// The BROWSER's half of the director exchange (spark ai-interview-parity; ADR 0010).
//
// The provider's realtime model runs each spoken turn; our server directs. This
// module is the wire discipline that sits between them, and it is deliberately pure:
// no React, no fetch, no clock of its own. Everything that can go wrong in a live
// call is a rule here rather than an ad-hoc branch in the 990-line call shell:
//
//   - TURNS ARE NUMBERED PER ATTEMPT FROM 0. A reconnect starts a new attempt and
//     numbers from 0 again (the server keys idempotence on (session, attempt, seq)),
//     so the resumed prior turns seeded into the visible transcript must NOT pass
//     through here — they already have their own attempt's numbers.
//   - EVERYTHING ABOVE ackSeq IS RESENT. A turn stays queued until the server says it
//     persisted it, so a dropped exchange costs latency, never a turn.
//   - AT MOST ONE TOOL CALL PER REQUEST, and requests are SERIALIZED. The model is
//     blocked on its tool result, so a second call queues behind the in-flight one
//     instead of racing it (two concurrent exchanges would also both decide the same
//     stage direction — the server locks, but the browser should not ask).
//   - A FAILED EXCHANGE NEVER STALLS THE CALL. `post` resolves null for every non-2xx
//     (409 INTERVIEW_NOT_LIVE, 429, 500, an offline fetch) and a waiting tool call is
//     answered TOOL_RESULT_FALLBACK by us. The call then runs undirected, which is the
//     documented degrade.
//
// The transport (fetch), the clock and the UI all arrive as injected callbacks, so
// every rule above is unit-testable without a browser (director-channel.test.ts).

import type {
  DirectorClientEvent,
  DirectorRequest,
  DirectorResponse,
  DirectorTurn,
} from "@/app/_lib/voice/director-types";

/** What we answer a waiting model with when the director could not be reached.
 *  It MUST read like the server's own "carry on" result, because the model cannot
 *  tell the two apart — `director-channel.test.ts` pins it to voice/director.ts's
 *  TOOL_RESULT_CONTINUE rather than importing that module into the candidate's
 *  bundle (it would drag the whole leadership policy in for one string). */
export const TOOL_RESULT_FALLBACK = "Continue with the agenda.";

/** Turns per request — the server's own MAX_DIRECTOR_TURNS_PER_REQUEST. Sending more
 *  is not a refusal (they simply go unacknowledged), but there is no point. */
export const MAX_TURNS_PER_REQUEST = 50;
/** Observations per request — the server's MAX_DIRECTOR_CLIENT_EVENTS_PER_REQUEST. */
export const MAX_EVENTS_PER_REQUEST = 20;
/** Observations held while the director is unreachable. Past this the OLDEST are
 *  dropped: they are telemetry, and an unbounded queue on a 45-minute call is not. */
export const MAX_QUEUED_EVENTS = 60;
/** Consecutive answered-but-progressless exchanges before the pump stops for this
 *  trigger. Without it a server that persists nothing (at its per-session event
 *  ceiling, so ackSeq never advances) would be posted at fetch speed forever. */
const MAX_PROGRESSLESS_EXCHANGES = 2;

export type DirectorToolCall = { callId: string; name: string; args: unknown };

/** Posts one exchange. Resolves the parsed body on a 2xx and NULL on anything else —
 *  every refusal, every throw. The channel's whole failure policy is "null means the
 *  director is unreachable right now". */
export type DirectorPost = (req: DirectorRequest) => Promise<DirectorResponse | null>;

export type DirectorChannelOptions = {
  token: string;
  sessionId: string;
  /** interview_sessions.attempts for THIS connect. */
  attempt: number;
  post: DirectorPost;
  /** Applied after every successful exchange: the directive to inject, the agenda
   *  state for the sidebar, endCall. Never called for a failed exchange. */
  onResponse?: (res: DirectorResponse) => void;
  /** Injected so tests can stamp deterministic turn times. */
  now?: () => Date;
};

export type DirectorChannel = {
  /** Queue a finalized turn and return the seq it was given. */
  recordTurn(role: DirectorTurn["role"], text: string, at?: string): number;
  /** Queue one browser observation (bounded; oldest dropped first). */
  recordEvent(event: DirectorClientEvent): void;
  /** Hand the model's tool call to the director. Always resolves — with the
   *  server's `toolResult`, or TOOL_RESULT_FALLBACK when it could not be reached. */
  callTool(call: DirectorToolCall): Promise<string>;
  /** Post even with nothing queued (the 20 s keep-alive): the answer carries the
   *  clock-driven directives and endCall, which nothing else would fetch. */
  heartbeat(): void;
  /** Stop starting new exchanges until `release()`. The transcription race is what
   *  this exists for: the model calls `mark_topic_covered` while the candidate's
   *  utterance is still being transcribed, so the shell holds the channel, waits for
   *  that turn, then calls the tool — and both ride ONE exchange, with the quote in
   *  the record before the director checks it. Always release in a `finally`. */
  hold(): void;
  release(): void;
  /** Resolves when the current pump has drained — the seam every test awaits. */
  idle(): Promise<void>;
  /** Stop posting. Queued tool calls are answered with the fallback so the model is
   *  never left waiting on a channel that will not answer. */
  close(): void;
  readonly closed: boolean;
  /** Turns queued but not yet acknowledged. */
  readonly pendingTurns: number;
  /** The seq the next recorded turn will take. */
  readonly nextSeq: number;
};

export function createDirectorChannel(options: DirectorChannelOptions): DirectorChannel {
  const { token, sessionId, attempt, post, onResponse } = options;
  const now = options.now ?? (() => new Date());

  let nextSeq = 0;
  let closed = false;
  let pumping: Promise<void> | null = null;
  let heartbeatDue = false;
  let held = 0;
  let pending: DirectorTurn[] = [];
  let events: DirectorClientEvent[] = [];
  const tools: Array<{ call: DirectorToolCall; resolve: (result: string) => void }> = [];

  const hasWork = () => pending.length > 0 || events.length > 0 || tools.length > 0 || heartbeatDue;

  /** Why a pump stopped. "drained" means there was nothing left to send — only then
   *  may work that arrived mid-flight start another one. "stalled" means the director
   *  is unreachable (or is answering without persisting anything): the queue is still
   *  full, and re-entering would be a fetch loop at full speed on a candidate's tab.
   *  The next turn, heartbeat or tool call is what tries again. */
  type PumpEnd = "drained" | "stalled";

  async function pump(): Promise<PumpEnd> {
    let progressless = 0;
    while (!closed && hasWork()) {
      if (progressless >= MAX_PROGRESSLESS_EXCHANGES) return "stalled";
      // CLAIMED, not peeked: `close()` answers everything still in the queue, and a
      // call already on the wire must not be answered twice (the fallback would win
      // the race and the model would be told "continue" while its real result was
      // arriving).
      const waiting = tools.shift() ?? null;
      const sentTurns = pending.slice(0, MAX_TURNS_PER_REQUEST);
      const sentEvents = events.slice(0, MAX_EVENTS_PER_REQUEST);
      heartbeatDue = false;
      let res: DirectorResponse | null = null;
      try {
        res = await post({
          token,
          sessionId,
          attempt,
          turns: sentTurns,
          events: sentEvents,
          tool: waiting ? waiting.call : null,
        });
      } catch {
        // `post` owns the transport and is documented to resolve null rather than
        // throw; a throw anyway is the same fact, so it takes the same path.
        res = null;
      }
      // The model is blocked on this result either way — an unreachable director
      // costs direction, not the interview.
      if (waiting) waiting.resolve(res?.toolResult ?? TOOL_RESULT_FALLBACK);
      if (!res) {
        // Keep the turns (they are unacknowledged) and the observations, and stop
        // pumping until something triggers the next flush. Retrying in a tight loop
        // against a director that is down is how a candidate's tab melts.
        return "stalled";
      }
      const ack = typeof res.ackSeq === "number" ? res.ackSeq : -1;
      const before = pending.length;
      pending = pending.filter((t) => t.seq > ack);
      events = events.slice(sentEvents.length);
      const progressed = pending.length < before || sentEvents.length > 0 || waiting !== null;
      progressless = progressed ? 0 : progressless + 1;
      try {
        onResponse?.(res);
      } catch (err) {
        // The consumer's own failure (a directive that could not be injected, a
        // setState after unmount) must not kill the exchange loop that is holding
        // the model's tool result.
        console.error("[voice] director response handler failed:", err);
      }
    }
    return "drained";
  }

  function flush(): void {
    if (closed || pumping || held > 0) return;
    pumping = pump().then(
      (end) => {
        pumping = null;
        // Work that arrived WHILE the pump was draining (a turn finalized during the
        // fetch) would otherwise sit until the next trigger — up to a heartbeat away.
        // Only after a clean drain: re-entering a stalled pump is a hot loop.
        if (end === "drained" && !closed && hasWork()) flush();
      },
      () => {
        pumping = null;
      },
    );
  }

  return {
    recordTurn(role, text, at) {
      const body = (text ?? "").trim();
      const seq = nextSeq;
      if (!body) return seq; // nothing to persist; the seq is not spent either
      nextSeq += 1;
      pending.push({ seq, role, text: body, at: at ?? now().toISOString() });
      flush();
      return seq;
    },
    recordEvent(event) {
      events.push(event);
      if (events.length > MAX_QUEUED_EVENTS) events = events.slice(-MAX_QUEUED_EVENTS);
      flush();
    },
    callTool(call) {
      if (closed) return Promise.resolve(TOOL_RESULT_FALLBACK);
      return new Promise<string>((resolve) => {
        tools.push({ call, resolve });
        flush();
      });
    },
    heartbeat() {
      heartbeatDue = true;
      flush();
    },
    hold() {
      held += 1;
    },
    release() {
      held = Math.max(0, held - 1);
      flush();
    },
    idle() {
      return pumping ?? Promise.resolve();
    },
    close() {
      closed = true;
      heartbeatDue = false;
      while (tools.length > 0) {
        const waiting = tools.shift();
        waiting?.resolve(TOOL_RESULT_FALLBACK);
      }
    },
    get closed() {
      return closed;
    },
    get pendingTurns() {
      return pending.length;
    },
    get nextSeq() {
      return nextSeq;
    },
  };
}
