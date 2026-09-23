// The interview SIMULATOR's conversation engine (spark interview-uat-tranche, WP-1).
//
// One simulated interview: the stand-in interviewer (a SimLlm holding the REAL private
// brief) and a simulated candidate (a different SimLlm holding only a persona) take
// turns on a SIMULATED clock, while the REAL director runs beside them exactly as the
// candidate's browser drives it in production:
//
//   - every finalized turn is posted to the director at once (director-channel.ts
//     recordTurn → flush), tagged with the block active before the exchange;
//   - every tool call is its own exchange (one tool per request), answered with the
//     director's exact result string, which goes back to the interviewer only;
//   - a heartbeat exchange every 20 simulated seconds, so clock-driven directions fire
//     while a candidate is still talking, as they do live;
//   - a directive is injected into the interviewer's context as a system line, verbatim
//     (`[Director] …`), WITHOUT prompting a reply — read before its next response;
//   - `endCall` (end_interview, end_now, the director's end limit) and the browser's own
//     fallback hard stop run the SAME end handshake the browser runs
//     (call-observations.ts): the call ends once the interviewer's current words finish,
//     and a closing line that does not START within END_START_GRACE_MS is never heard —
//     the call ends 4 s after the signal, cutting off a candidate who is still talking.
//
// SPEECH AFTER TOOLS. Production's model calls a tool, waits for the result
// (function_call_output), and only then speaks (response.create). A text reply carries
// both at once, so the engine applies a reply's tool calls FIRST and treats its words as
// spoken AFTER them — and when the director REFUSES a call (a rejected quote, a refused
// "complete", a covered block begun again, extra time never requested), the words are
// withheld, as if never generated, and the stand-in is asked to continue with the result
// in hand. A reply of tool lines alone gets the same continuation (production: the model
// speaks after the result). At most MAX_CONTINUATIONS per turn; the last one's words
// stand whatever the director said.
//
// WHAT CROSSES TO THE CANDIDATE: the interviewer's SPOKEN words, nothing else. Never the
// brief, never a tool line or result, never a [Director] note (engine.test.ts guards it).
// If the interviewer SAYS one of those aloud, the candidate hears it — that is the
// interviewer's leak, recorded in its own turn, not a harness path.
//
// The scaffolding (the harness preambles, the opening and continue cues, the turn
// caps) lives here, on the wrapper, never inside the brief under test — the registry's
// "scaffolding leaking into the instrument" failure. `instrument.briefSha` is the
// digest of the brief alone.

import {
  END_QUIET_MS,
  END_START_GRACE_MS,
  extendedHardStopDeadline,
  hardStopDelayMs,
} from "../../_components/voice/call-observations";
import {
  endCeilingMin,
  outstandingMustAsks,
  TOOL_RESULT_CONTINUE,
  type DirectorState,
  type DirectorToolCallInput,
} from "../voice/director";
import { parseDirectorTool } from "../voice/director-step";
import { DIRECTOR_TOOL_DEFS, type DirectiveKind } from "../voice/director-types";
import { DIRECTOR_HEARTBEAT_MS, SIM_EPOCH_MS, SPEAKING_WPM, spokenMs, spokenPrefix, TURN_LATENCY_MS } from "./clock";
import { InMemoryDirector, type SimDirectorTurn, type SimExchangeResult } from "./director-loop";
import { parseCandidateReply, parseInterviewerReply, toolLinesOf, toolResultLine } from "./tool-line";
import type { SimInstrument } from "./instrument";
import { situationSha } from "./situations";
import {
  SIM_TOOL_LINE_EXAMPLE,
  type SimConversation,
  type SimEndReason,
  type SimLlm,
  type SimSituation,
  type SimTurn,
} from "./types";

// ---- the harness scaffolding (never part of the brief under test) -------------------------

/** The ONE harness preamble the stand-in interviewer gets, after the brief: how this text
 *  channel stands in for the voice channel's function calling, plus the tool definitions
 *  production declares to the provider (director-tools.mjs, verbatim). */
export const INTERVIEWER_HARNESS_PREAMBLE = [
  "TEST HARNESS — this text channel stands in for the live voice call. Nothing in this section is an interviewing instruction; it only replaces the voice channel's function calling.",
  "Everything you write is spoken aloud to the candidate, except tool lines. Write only the words you would say: no stage directions, no speaker labels, no markdown.",
  `To call a tool, write it on a line of its own, before the words that go with it, as one JSON object with "name" and "args": ${SIM_TOOL_LINE_EXAMPLE}`,
  "The candidate never hears tool lines. Each answer comes back to you on a line starting <<result NAME>>; when an answer refuses a call, your words after that call are not spoken and you are asked to continue.",
  'In what you receive, lines starting "Candidate:" are the candidate\'s own words, and lines starting [Director] are the producer notes your instructions describe.',
  `The tools (name, description, JSON-schema parameters): ${JSON.stringify(DIRECTOR_TOOL_DEFS)}`,
].join("\n");

/** The simulated candidate's harness preamble, before its persona. */
export const CANDIDATE_HARNESS_PREAMBLE = [
  "You are role-playing a job candidate in a live, spoken first-round interview with an AI interviewer; the interviewer's words reach you as the user's messages. Stay in the character described below for the whole call, and never say that this is a role-play or a test.",
  "Reply with ONLY the words you say out loud, in the first person — no narration, no stage directions, no quotation marks, no speaker labels.",
  "To stay silent, or to think before you speak, write <<pause N>> (N in seconds) before your words; a reply that is only <<pause N>> means you said nothing.",
  "The character:",
].join("\n");

export const OPENING_CUE = "(The call is connected and the candidate is listening. Begin the interview.)";
export const CONTINUE_CUE = "(Continue your turn.)";
export const INTERVIEWER_SILENT_CUE = "(The interviewer says nothing.)";

/** Continuations one interviewer turn may take after tool results. */
export const MAX_CONTINUATIONS = 2;

export type SimLimits = {
  /** Model calls (both sides) one conversation may spend; reaching it ends the call
   *  with `max_turns`. */
  maxCalls: number;
  /** Candidate turns one conversation may take (the Python eval's MAX_CANDIDATE_TURNS,
   *  sized for a clock-driven 20–30 minute call rather than a 5-minute screen). */
  maxCandidateTurns: number;
};
export const DEFAULT_SIM_LIMITS: SimLimits = { maxCalls: 120, maxCandidateTurns: 50 };

export function interviewerSystem(instrument: Pick<SimInstrument, "privateBrief">): string {
  return `${instrument.privateBrief}\n\n---\n\n${INTERVIEWER_HARNESS_PREAMBLE}`;
}

export function candidateSystem(situation: Pick<SimSituation, "persona">): string {
  return `${CANDIDATE_HARNESS_PREAMBLE}\n${situation.persona}`;
}

// ---- the dump --------------------------------------------------------------------------

/** Everything beyond the contract a later judgement may need: the director's full
 *  record, the directives it sent, where the state ended, and how the call ended. */
export type SimTrace = {
  engine: "interview-sim/1";
  instrumentKey: string;
  locale: string | null;
  bookedMin: number;
  providers: { interviewer: string; candidate: string };
  clock: { wpm: number; turnLatencyMs: number; heartbeatMs: number; epochIso: string };
  limits: SimLimits;
  /** The in-memory interview_events record, in record order (`createdAt` on the
   *  simulated clock, from `clock.epochIso`). */
  events: InMemoryDirector["events"];
  directives: { simAtMs: number; id: string; kind: DirectiveKind; blockId: string | null }[];
  final: {
    activeBlockId: string | null;
    coveredBlockIds: string[];
    begunBlockIds: string[];
    elapsedMs: number;
    /** The director's end limit (endCeilingMin) as the call ended, in live ms. */
    endLimitMs: number;
    overrunRequested: boolean;
    overrunAnswer: string | null;
    outstandingMustAsks: { blockId: string; id: string; text: string }[];
  };
  /** The first end signal: what raised it and when (null when the call ended some other way). */
  endSignal: { source: SimEndReason; simAtMs: number } | null;
  /** Where the browser's fallback hard stop was armed when the end signal arrived (or
   *  when the call ended, if none did) — compare it with `final.endLimitMs`: the two
   *  disagreeing is a client/server mismatch. */
  hardStopAtSimMs: number | null;
};

export type SimConversationDump = SimConversation & { trace: SimTrace };

export type RunConversationInput = {
  runId: string;
  situation: SimSituation;
  instrument: SimInstrument;
  interviewer: SimLlm;
  candidate: SimLlm;
  limits?: Partial<SimLimits>;
};

// ---- internals ----------------------------------------------------------------------------

type Msg = { role: "user" | "assistant"; content: string };

/** One speaker's view of the call, folded so roles alternate. */
class View {
  private readonly msgs: Msg[] = [];
  private add(role: Msg["role"], text: string): void {
    const t = text.trim();
    if (!t) return;
    const last = this.msgs[this.msgs.length - 1];
    if (last && last.role === role) last.content = `${last.content}\n${t}`;
    else this.msgs.push({ role, content: t });
  }
  user(text: string): void {
    this.add("user", text);
  }
  assistant(text: string): void {
    this.add("assistant", text);
  }
  messages(): Msg[] {
    return this.msgs.map((m) => ({ ...m }));
  }
}

class CallCapReached extends Error {}

type EndSignal = { source: SimEndReason; atSimMs: number };

/** Whether the director REFUSED a call — the cases where production's model would have
 *  spoken differently after reading the result. */
function refused(tool: DirectorToolCallInput, res: SimExchangeResult, before: DirectorState): boolean {
  const events = res.outcome?.events ?? [];
  if (events.some((e) => e.kind === "topic_cover_rejected")) return true;
  if (events.some((e) => e.kind === "end_requested" && e.payload.refused === true)) return true;
  const args = tool.args !== null && typeof tool.args === "object" ? (tool.args as Record<string, unknown>) : {};
  if (tool.name === "begin_topic" && typeof args.block_id === "string" && before.coveredBlockIds.includes(args.block_id.trim())) return true;
  if (tool.name === "report_extra_time" && before.overrunRequestedAtMs === null) return true;
  return false;
}

class SimCall {
  private simMs = 0;
  private readonly turns: SimTurn[] = [];
  private turnSeq = 0;
  private directorSeq = 0;
  private callSeq = 0;
  private calls = 0;
  private candidateTurns = 0;
  private nextHeartbeatMs = DIRECTOR_HEARTBEAT_MS;
  private hardStopAt: number | null;
  private endSignal: EndSignal | null = null;
  private endedBy: SimEndReason | null = null;
  private error: string | undefined;
  private readonly directives: SimTrace["directives"] = [];
  private readonly iv = new View();
  private readonly cv = new View();
  private readonly director: InMemoryDirector;
  private readonly limits: SimLimits;
  private readonly ivSystem: string;
  private readonly cvSystem: string;

  constructor(private readonly input: RunConversationInput) {
    this.limits = { ...DEFAULT_SIM_LIMITS, ...input.limits };
    this.director = new InMemoryDirector(input.instrument.agenda, SIM_EPOCH_MS);
    const delay = hardStopDelayMs({ hardCapMin: input.instrument.agenda.hardCapMin, priorElapsedSec: 0 });
    this.hardStopAt = delay === null ? null : SIM_EPOCH_MS + delay;
    this.ivSystem = interviewerSystem(input.instrument);
    this.cvSystem = candidateSystem(input.situation);
    this.iv.user(OPENING_CUE);
  }

  private now(): number {
    return SIM_EPOCH_MS + this.simMs;
  }

  private record(turn: Omit<SimTurn, "seq" | "simAtMs">): void {
    this.turns.push({ seq: this.turnSeq++, simAtMs: this.simMs, ...turn });
  }

  private note(text: string): void {
    this.record({ role: "system", text });
  }

  private finish(reason: SimEndReason, error?: string): void {
    if (this.endedBy) return;
    this.endedBy = reason;
    if (error) this.error = error;
  }

  private async call(llm: SimLlm, system: string, messages: Msg[]): Promise<string> {
    if (this.calls >= this.limits.maxCalls) throw new CallCapReached();
    this.calls += 1;
    return llm.complete({ system, messages });
  }

  /** One director exchange at the current simulated time. */
  private exchange(turns: SimDirectorTurn[], tool: DirectorToolCallInput | null): SimExchangeResult {
    const res = this.director.exchange({ turns, tool, nowMs: this.now() });
    if (res.directive) {
      this.record({ role: "director", text: res.directive.text });
      this.directives.push({ simAtMs: this.simMs, id: res.directive.id, kind: res.directive.kind, blockId: res.directive.blockId });
      this.iv.user(res.directive.text);
    }
    // The browser re-arms its fallback stop from every clock it is handed — until an end
    // signal starts the handshake, after which the stop is moot (past the limit every
    // response would re-arm it to "now") and the trace keeps where it stood.
    if (res.clock && this.hardStopAt !== null && !this.endSignal) {
      const later = extendedHardStopDeadline({ armedAtMs: this.hardStopAt, clock: res.clock, nowMs: this.now(), agenda: this.input.instrument.agenda });
      if (later !== null) this.hardStopAt = later;
    }
    if (res.endCall && !this.endSignal) {
      const byInterviewer = Boolean(res.outcome?.endCall) || res.state.endRequested;
      this.endSignal = { source: byInterviewer ? "end_interview" : "director_end", atSimMs: this.simMs };
    }
    return res;
  }

  /** Move the simulated clock to `targetMs`, running every heartbeat (and the fallback
   *  hard stop) that falls on the way. With `cutForEnd`, stop at the end handshake's
   *  deadline once an end signal is pending (someone other than the interviewer is
   *  talking, so no closing line can start). Returns where the clock stopped. */
  private advanceTo(targetMs: number, cutForEnd: boolean): number {
    const deadline = () => (cutForEnd && this.endSignal ? this.endSignal.atSimMs + END_START_GRACE_MS : Infinity);
    let target = Math.min(targetMs, Math.max(this.simMs, deadline()));
    for (;;) {
      const stopAt = this.hardStopAt !== null && !this.endSignal ? this.hardStopAt - SIM_EPOCH_MS : Infinity;
      const next = Math.min(this.nextHeartbeatMs, stopAt);
      if (next > target) break;
      this.simMs = Math.max(this.simMs, next);
      if (next === this.nextHeartbeatMs) {
        this.exchange([], null);
        this.nextHeartbeatMs += DIRECTOR_HEARTBEAT_MS;
      }
      if (!this.endSignal && this.hardStopAt !== null && this.now() >= this.hardStopAt) {
        this.endSignal = { source: "hard_stop", atSimMs: this.simMs };
      }
      target = Math.min(target, Math.max(this.simMs, deadline()));
    }
    this.simMs = Math.max(this.simMs, target);
    return this.simMs;
  }

  /** The end handshake's deadline for a closing line to START, or Infinity. */
  private lineDeadline(): number {
    return this.endSignal ? this.endSignal.atSimMs + END_START_GRACE_MS : Infinity;
  }

  private endWithoutLine(): void {
    const signal = this.endSignal as EndSignal;
    this.simMs = Math.max(this.simMs, signal.atSimMs + END_START_GRACE_MS);
    this.note(`the call ended ${END_START_GRACE_MS / 1000} s after the end signal: no closing line started in time`);
    this.finish(signal.source);
  }

  async interviewerTurn(): Promise<void> {
    if (this.endSignal && this.simMs + TURN_LATENCY_MS > this.lineDeadline()) return this.endWithoutLine();
    this.advanceTo(this.simMs + TURN_LATENCY_MS, false);
    const spoken: string[] = [];
    for (let continuations = 0; ; continuations += 1) {
      const reply = await this.call(this.input.interviewer, this.ivSystem, this.iv.messages());
      const parsed = parseInterviewerReply(reply);
      for (const n of parsed.notes) this.note(n);
      let anyRefused = false;
      const results: string[] = [];
      for (const call of parsed.calls) {
        const callId = `sim-${++this.callSeq}`;
        const tool = call.ok ? parseDirectorTool({ callId, name: call.name, args: call.args }) : null;
        const before = this.director.stateAt(this.now());
        const res = this.exchange([], tool);
        const result = res.toolResult ?? TOOL_RESULT_CONTINUE;
        this.record({ role: "system", text: call.raw, tool: { name: call.name ?? "(unparsed)", args: call.args, result } });
        results.push(toolResultLine(call.name, result));
        if (tool && refused(tool, res, before)) anyRefused = true;
      }
      const canContinue = continuations < MAX_CONTINUATIONS;
      const withhold = anyRefused && parsed.spoken !== "" && canContinue;
      // The stand-in's own context keeps its calls — and its words only if they were said
      // (and never a harness artifact the parser cut, such as a line it wrote for the
      // candidate).
      this.iv.assistant(withhold ? toolLinesOf(parsed) : [toolLinesOf(parsed), parsed.spoken].filter(Boolean).join("\n"));
      if (withhold) this.note(`harness: withheld the interviewer's words after a refused tool call: ${JSON.stringify(parsed.spoken)}`);
      else if (parsed.spoken) spoken.push(parsed.spoken);
      for (const line of results) this.iv.user(line);
      const needsMore = canContinue && (withhold || (parsed.calls.length > 0 && parsed.spoken === ""));
      if (!needsMore) break;
      this.iv.user(CONTINUE_CUE);
      this.advanceTo(this.simMs + TURN_LATENCY_MS, false);
    }

    const text = spoken.join(" ").trim();
    // A closing line that starts after the handshake's grace is never heard.
    if (this.endSignal && (!text || this.simMs > this.lineDeadline())) return this.endWithoutLine();
    if (!text) {
      this.note("the interviewer said nothing this turn");
      this.cv.user(INTERVIEWER_SILENT_CUE);
      return;
    }
    this.advanceTo(this.simMs + spokenMs(text), false);
    this.record({ role: "interviewer", text });
    this.cv.user(text);
    this.exchange([{ seq: this.directorSeq++, role: "interviewer", text }], null);
    // The handshake waits for these words when the end was signalled before they
    // finished; a signal raised by the exchange that closed them waits for a NEW line.
    if (this.endSignal && this.endSignal.atSimMs < this.simMs) {
      this.simMs += END_QUIET_MS;
      this.finish(this.endSignal.source);
    }
  }

  async candidateTurn(first: boolean): Promise<void> {
    if (this.candidateTurns >= this.limits.maxCandidateTurns) return this.finish("max_turns");
    if (this.endSignal && this.simMs + TURN_LATENCY_MS >= this.lineDeadline()) {
      this.simMs = Math.max(this.simMs, this.lineDeadline());
      this.note(`the call ended ${END_START_GRACE_MS / 1000} s after the end signal, before the candidate spoke`);
      return this.finish(this.endSignal.source);
    }
    const scripted = first && this.input.situation.firstMessage ? this.input.situation.firstMessage : null;
    const raw = scripted ?? (await this.call(this.input.candidate, this.cvSystem, this.cv.messages()));
    this.candidateTurns += 1;
    this.cv.assistant(raw);
    const parsed = parseCandidateReply(raw);
    for (const n of parsed.notes) this.note(n);

    // Thinking time (latency + any pause), then the words — both cut short by the end
    // handshake when an end signal is pending and nobody else can start a closing line.
    const intendedStart = this.simMs + TURN_LATENCY_MS + parsed.pauseMs;
    const speechStart = this.advanceTo(intendedStart, true);
    const wordsMs = spokenMs(parsed.spoken);
    const reached = speechStart < intendedStart ? speechStart : this.advanceTo(speechStart + wordsMs, true);
    if (speechStart < intendedStart || reached < speechStart + wordsMs) {
      // The browser's end handshake ran out while the candidate was still silent or talking.
      const share = wordsMs > 0 && speechStart >= intendedStart ? (reached - speechStart) / wordsMs : 0;
      const said = spokenPrefix(parsed.spoken, share);
      if (said) {
        this.record({ role: "candidate", text: `${said} —` });
        this.iv.user(`Candidate: ${said} —`);
      }
      this.note(`the call ended ${END_START_GRACE_MS / 1000} s after the end signal, cutting the candidate off`);
      return this.finish((this.endSignal as EndSignal).source);
    }
    if (!parsed.spoken) {
      const seconds = Math.round((TURN_LATENCY_MS + parsed.pauseMs) / 1000);
      this.note(`the candidate stayed silent for ${seconds} s`);
      this.iv.user(`(The candidate stays silent for ${seconds} seconds.)`);
      return;
    }
    this.record({ role: "candidate", text: parsed.spoken });
    this.iv.user(`Candidate: ${parsed.spoken}`);
    this.exchange([{ seq: this.directorSeq++, role: "candidate", text: parsed.spoken }], null);
  }

  async run(): Promise<SimConversationDump> {
    try {
      await this.interviewerTurn();
      for (let first = true; !this.endedBy; first = false) {
        await this.candidateTurn(first);
        if (this.endedBy) break;
        await this.interviewerTurn();
      }
    } catch (err) {
      if (err instanceof CallCapReached) {
        this.note(`harness: the ${this.limits.maxCalls}-call cap was reached`);
        this.finish("max_turns");
      } else {
        const message = err instanceof Error ? err.message : String(err);
        this.note(`harness: a provider failed: ${message.slice(0, 500)}`);
        this.finish("error", message.slice(0, 2000));
      }
    }
    return this.dump();
  }

  private dump(): SimConversationDump {
    const { instrument, situation, runId } = this.input;
    const state = this.director.stateAt(this.now());
    return {
      runId,
      situationId: situation.id,
      situationSha: situationSha(situation),
      fixture: instrument.fixture,
      instrument: { ...instrument.record, agendaBlockIds: [...instrument.record.agendaBlockIds] },
      turns: this.turns,
      endedBy: this.endedBy ?? "error",
      simElapsedMs: this.simMs,
      calls: this.calls,
      ...(this.error ? { error: this.error } : {}),
      trace: {
        engine: "interview-sim/1",
        instrumentKey: instrument.key,
        locale: instrument.locale,
        bookedMin: instrument.agenda.durationMin,
        providers: { interviewer: this.input.interviewer.id, candidate: this.input.candidate.id },
        clock: { wpm: SPEAKING_WPM, turnLatencyMs: TURN_LATENCY_MS, heartbeatMs: DIRECTOR_HEARTBEAT_MS, epochIso: new Date(SIM_EPOCH_MS).toISOString() },
        limits: this.limits,
        events: this.director.events,
        directives: this.directives,
        final: {
          activeBlockId: state.activeBlockId,
          coveredBlockIds: state.coveredBlockIds,
          begunBlockIds: state.begunBlockIds,
          elapsedMs: state.elapsedMs,
          endLimitMs: endCeilingMin(instrument.agenda, state) * 60_000,
          overrunRequested: state.overrunRequestedAtMs !== null,
          overrunAnswer: state.overrunAnswer,
          outstandingMustAsks: outstandingMustAsks(instrument.agenda, state),
        },
        endSignal: this.endSignal ? { source: this.endSignal.source, simAtMs: this.endSignal.atSimMs } : null,
        hardStopAtSimMs: this.hardStopAt === null ? null : this.hardStopAt - SIM_EPOCH_MS,
      },
    };
  }
}

/** Run one simulated interview to its end and return everything it produced. Never
 *  throws: a provider failure ends the conversation with `endedBy: "error"`. */
export async function runConversation(input: RunConversationInput): Promise<SimConversationDump> {
  if (input.interviewer === input.candidate) {
    throw new Error("[interview-sim] the interviewer and the candidate must be different SimLlm instances");
  }
  return new SimCall(input).run();
}
