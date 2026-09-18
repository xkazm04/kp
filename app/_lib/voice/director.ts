// The interview DIRECTOR's policy (spark ai-interview-parity; ADR 0010). PURE: no DB,
// no clock reads, no randomness — every input arrives as a parameter, so the whole
// leadership policy is a table of (agenda, events, now) → decision that a test can pin.
//
// The provider's realtime model runs each spoken turn; this module decides what it is
// TOLD between turns. The operator doctrine is that the interviewer LEADS — it holds
// the frame, the clock and the agenda — and the chosen leadership policy is
// COVERAGE FIRST, THEN CLOCK:
//
//   - a topic is never cut before its budget is spent;
//   - at budget, still without concrete evidence, the model is told ONCE to ask a
//     narrower question for a concrete instance;
//   - the block may then overrun by up to half its budget, bounded by the slack the
//     rest of the agenda leaves under the hard cap — after that, move on;
//   - once the clock reaches the close reserve, skip to the candidate's questions and
//     the closing; two minutes past the hard cap, end.
//
// (registry: interview-run-of-show — per-question-time-budget-that-tightens,
// slack-absorbing-open-block, fixed-opening-and-closing-blocks.)
//
// Directive text transits the candidate's browser (it is injected into the provider
// session from there), so it names blocks ONLY by id and candidate-safe title — never
// a competency, a goal or anything else from the private brief.
//
// Tool calls are handled here too, and they never throw: a malformed call is answered
// with a short "continue with the agenda". `mark_topic_covered` is accepted only when
// its evidence quote is the candidate's own persisted words (structured-interview-
// scorecards — evidence-quote-requirement). Integrity observations (guardrails, focus,
// answer timing) are RECORDED, never scored and never decisive
// (ai-assistance-detection-and-fairness — observed-process-is-supporting-not-load-bearing).

import {
  DIRECTOR_NOTE_PREFIX,
  END_REASONS,
  GUARDRAIL_KINDS,
  MAX_EVIDENCE_QUOTE_CHARS,
  type AgendaBlock,
  type AgendaBlockKind,
  type Directive,
  type DirectiveKind,
  type DirectorAgendaState,
  type InterviewAgenda,
  type InterviewEventKind,
} from "./director-types";
import { matchQuoteToTurn, normalizeQuoteText, type QuoteMatchOptions } from "../quote-match";

// ---- tunables (named, so the policy table in the docs can cite them) ---------------

/** The same (kind, block) directive is never repeated inside this window. */
export const DIRECTIVE_DEDUPE_MS = 60_000;
/** `end_now` fires this many minutes past the hard cap. */
export const END_GRACE_MIN = 2;
/** An uncovered block may overrun by at most this share of its own budget. */
export const EXTENSION_SHARE = 0.5;
/** A forwarded candidate question is stored up to this many characters. */
export const MAX_FORWARDED_QUESTION_CHARS = 500;
/** A covered-topic quote must carry at least this many words — "yes" is provenance,
 *  not evidence. */
export const MIN_EVIDENCE_QUOTE_WORDS = 3;

const MINUTE_MS = 60_000;

/** Blocks that never get "ask a narrower question": they collect no scored evidence. */
const NO_STAY_NARROW: ReadonlySet<AgendaBlockKind> = new Set<AgendaBlockKind>(["warmup", "role_qa", "close"]);
/** The fixed closing blocks the close reserve holds (and `close_now` skips to). */
const CLOSING_KINDS: ReadonlySet<AgendaBlockKind> = new Set<AgendaBlockKind>(["role_qa", "close"]);

/** The director's quote check: the quote must sit INSIDE what the candidate said
 *  (never a summary that merely contains a short turn), and a word-overlap fallback
 *  needs a clear majority of the quote's distinctive words. */
export const EVIDENCE_QUOTE_MATCH: QuoteMatchOptions = {
  minChars: 8,
  minWordOverlap: 0.6,
  minSharedWords: 2,
  allowTurnInsideQuote: false,
  spanAdjacentTurns: true,
};

// ---- inputs --------------------------------------------------------------------------

/** The slice of an interview_events row the director reads (structurally a subset of
 *  db/interview-events.ts InterviewEvent, so store rows pass straight in). */
export type DirectorEvent = {
  kind: InterviewEventKind;
  attempt: number;
  seq: number | null;
  blockId: string | null;
  payload: Record<string, unknown>;
  /** SERVER record time (ISO) — the only clock the arithmetic runs on. */
  createdAt: string;
};

/** An event the director asks its caller to persist (the caller adds session, attempt
 *  and time). */
export type DirectorEventDraft = {
  kind: InterviewEventKind;
  blockId: string | null;
  payload: Record<string, unknown>;
};

export type DirectorStateInput = {
  agenda: InterviewAgenda | null;
  /** The session's events in record order. */
  events: readonly DirectorEvent[];
  /** interview_sessions.attempts — the attempt being directed now. */
  currentAttempt: number;
  /** When the current attempt connected, if known. Used when it has no events yet
   *  (and never later than its first event). */
  attemptStartedAtMs: number | null;
  nowMs: number;
};

export type DirectorState = {
  /** Live milliseconds across every attempt; the current one runs to `nowMs`. */
  elapsedMs: number;
  /** Live milliseconds across the attempts BEFORE the current one. */
  priorAttemptsMs: number;
  activeBlockId: string | null;
  /** Agenda order. */
  coveredBlockIds: string[];
  /** Blocks with a `topic_begun`, agenda order. */
  begunBlockIds: string[];
  /** Live milliseconds each block has been the active one. */
  spentMsByBlock: Record<string, number>;
  /** `${kind}|${blockId}` → server time of the latest such directive. */
  lastDirectiveMs: Record<string, number>;
  /** Blocks that already received their one `stay_narrow`. */
  stayNarrowBlockIds: string[];
  resumeSentThisAttempt: boolean;
  hasPriorAttemptEvents: boolean;
  /** The model called end_interview during the current attempt. */
  endRequested: boolean;
  /** callId → the tool result already returned for it (a retried POST replays it). */
  toolResultsByCallId: Record<string, string>;
};

// ---- state -------------------------------------------------------------------------

function ms(iso: string): number {
  return Date.parse(iso);
}

function blockIndex(agenda: InterviewAgenda | null): Map<string, AgendaBlock> {
  const map = new Map<string, AgendaBlock>();
  for (const b of agenda?.blocks ?? []) {
    if (b && typeof b.id === "string" && !map.has(b.id)) map.set(b.id, b);
  }
  return map;
}

function directiveKey(kind: string, blockId: string | null): string {
  return `${kind}|${blockId ?? ""}`;
}

/** Derive where the conversation is from its record. Pure. */
export function deriveDirectorState(input: DirectorStateInput): DirectorState {
  const { agenda, events, currentAttempt, attemptStartedAtMs, nowMs } = input;
  const blocks = blockIndex(agenda);

  // 1. Attempt spans on the server clock: first → last event; the current attempt
  //    starts at its connect (when earlier than its first event) and runs to now.
  const spans = new Map<number, { start: number; end: number }>();
  for (const e of events) {
    const t = ms(e.createdAt);
    if (!Number.isFinite(t) || !Number.isInteger(e.attempt)) continue;
    const s = spans.get(e.attempt);
    if (!s) spans.set(e.attempt, { start: t, end: t });
    else {
      s.start = Math.min(s.start, t);
      s.end = Math.max(s.end, t);
    }
  }
  const cur = spans.get(currentAttempt);
  let curStart = Math.min(cur?.start ?? Infinity, Number.isFinite(attemptStartedAtMs) ? (attemptStartedAtMs as number) : Infinity);
  if (!Number.isFinite(curStart)) curStart = nowMs;
  curStart = Math.min(curStart, nowMs);
  spans.set(currentAttempt, { start: curStart, end: Math.max(nowMs, cur?.end ?? nowMs) });

  const order = [...spans.keys()].sort((a, b) => a - b);
  const offset = new Map<number, number>();
  let total = 0;
  let prior = 0;
  for (const a of order) {
    const s = spans.get(a)!;
    offset.set(a, total);
    const len = Math.max(0, s.end - s.start);
    total += len;
    if (a < currentAttempt) prior += len;
  }
  const liveAt = (e: DirectorEvent): number => {
    const s = spans.get(e.attempt);
    const t = ms(e.createdAt);
    if (!s || !Number.isFinite(t)) return total;
    return (offset.get(e.attempt) ?? 0) + Math.min(Math.max(0, t - s.start), s.end - s.start);
  };

  // 2. Blocks, directives, tool replays — one pass in record order.
  let active: string | null = null;
  let activeSince = 0;
  const spent: Record<string, number> = {};
  const begun = new Set<string>();
  const covered = new Set<string>();
  const lastDirectiveMs: Record<string, number> = {};
  const stayNarrow = new Set<string>();
  const toolResultsByCallId: Record<string, string> = {};
  let resumeSentThisAttempt = false;
  let hasPriorAttemptEvents = false;
  let endRequested = false;

  const closeActive = (at: number) => {
    if (active !== null) spent[active] = (spent[active] ?? 0) + Math.max(0, at - activeSince);
    active = null;
  };

  for (const e of events) {
    if (e.attempt < currentAttempt) hasPriorAttemptEvents = true;
    const callId = e.payload?.callId;
    const toolResult = e.payload?.toolResult;
    if (typeof callId === "string" && typeof toolResult === "string" && !(callId in toolResultsByCallId)) {
      toolResultsByCallId[callId] = toolResult;
    }
    switch (e.kind) {
      case "topic_begun": {
        if (!e.blockId || !blocks.has(e.blockId) || e.blockId === active) break;
        const at = liveAt(e);
        closeActive(at);
        begun.add(e.blockId);
        if (!covered.has(e.blockId)) {
          active = e.blockId;
          activeSince = at;
        }
        break;
      }
      case "topic_covered": {
        if (!e.blockId || !blocks.has(e.blockId)) break;
        covered.add(e.blockId);
        if (active === e.blockId) closeActive(liveAt(e));
        break;
      }
      case "directive": {
        const kind = typeof e.payload?.kind === "string" ? e.payload.kind : null;
        if (!kind) break;
        const t = ms(e.createdAt);
        const key = directiveKey(kind, e.blockId);
        if (Number.isFinite(t)) lastDirectiveMs[key] = Math.max(lastDirectiveMs[key] ?? -Infinity, t);
        if (kind === "stay_narrow" && e.blockId) stayNarrow.add(e.blockId);
        if (kind === "resume" && e.attempt === currentAttempt) resumeSentThisAttempt = true;
        break;
      }
      case "end_requested": {
        // A refused "complete" (payload.refused) is an audit row, not an end.
        if (e.attempt === currentAttempt && e.payload?.refused !== true) endRequested = true;
        break;
      }
      default:
        break;
    }
  }
  if (active !== null) spent[active] = (spent[active] ?? 0) + Math.max(0, total - activeSince);

  const inAgendaOrder = (set: Set<string>) => (agenda?.blocks ?? []).map((b) => b.id).filter((id) => set.has(id));
  return {
    elapsedMs: total,
    priorAttemptsMs: prior,
    activeBlockId: active,
    coveredBlockIds: inAgendaOrder(covered),
    begunBlockIds: inAgendaOrder(begun),
    spentMsByBlock: spent,
    lastDirectiveMs,
    stayNarrowBlockIds: inAgendaOrder(stayNarrow),
    resumeSentThisAttempt,
    hasPriorAttemptEvents,
    endRequested,
    toolResultsByCallId,
  };
}

/** The wire projection of the state: ids only. */
export function directorAgendaState(state: DirectorState): DirectorAgendaState {
  return { activeBlockId: state.activeBlockId, coveredBlockIds: [...state.coveredBlockIds] };
}

// ---- decisions -----------------------------------------------------------------------

function budgetMs(b: AgendaBlock): number | null {
  return Number.isFinite(b.budgetMin) && b.budgetMin >= 0 ? b.budgetMin * MINUTE_MS : null;
}

/** Minutes the rest of the agenda can still give away:
 *  hardCap − closeReserve − elapsed − Σ budgets of the blocks not yet started. The
 *  closing blocks are NOT in that sum — the close reserve already holds them. */
export function slackMs(agenda: InterviewAgenda, state: DirectorState): number {
  const begun = new Set(state.begunBlockIds);
  const covered = new Set(state.coveredBlockIds);
  let pending = 0;
  for (const b of agenda.blocks) {
    if (begun.has(b.id) || covered.has(b.id) || CLOSING_KINDS.has(b.kind)) continue;
    pending += budgetMs(b) ?? 0;
  }
  return (agenda.hardCapMin - agenda.closeReserveMin) * MINUTE_MS - state.elapsedMs - pending;
}

/** The block to move to after `fromId`: the first block after it (agenda order) that
 *  was never begun and is not covered; else the first such block anywhere; else null. */
export function nextAgendaBlock(agenda: InterviewAgenda, state: DirectorState, fromId: string | null): AgendaBlock | null {
  const begun = new Set(state.begunBlockIds);
  const covered = new Set(state.coveredBlockIds);
  const eligible = (b: AgendaBlock) => b.id !== fromId && !begun.has(b.id) && !covered.has(b.id);
  const from = fromId === null ? -1 : agenda.blocks.findIndex((b) => b.id === fromId);
  return agenda.blocks.slice(from + 1).find(eligible) ?? agenda.blocks.find(eligible) ?? null;
}

function label(b: AgendaBlock): string {
  const title = String(b.title ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  return title ? `${b.id} (“${title}”)` : b.id;
}

function directiveText(kind: DirectiveKind, block: AgendaBlock | null, from: AgendaBlock | null): string {
  const body = (() => {
    switch (kind) {
      case "stay_narrow":
        return `Block ${label(block!)} has used its time without a concrete example. Ask one narrower question for a concrete instance from the candidate's own experience.`;
      case "move_on":
        return from
          ? `Time for block ${label(from)} is up. Close it in one short sentence and begin block ${label(block!)} now (call begin_topic).`
          : `Begin block ${label(block!)} now (call begin_topic).`;
      case "close_now":
        return block
          ? `The interview is near its time limit. Skip the remaining topics and begin block ${label(block)} now (call begin_topic).`
          : `The interview is near its time limit. Skip the remaining topics and move to the candidate's questions and your closing.`;
      case "end_now":
        return `The interview is over time. Say one short closing line now and call end_interview with reason "time".`;
      case "resume":
        return block
          ? `The call reconnected after a drop. Do not start over or repeat the introduction: welcome the candidate back in one sentence and continue with block ${label(block)}.`
          : `The call reconnected after a drop. Do not start over or repeat the introduction: welcome the candidate back in one sentence and continue with the agenda.`;
    }
  })();
  return `${DIRECTOR_NOTE_PREFIX} ${body}`;
}

export type DecideDirectiveInput = {
  agenda: InterviewAgenda | null;
  state: DirectorState;
  currentAttempt: number;
  nowMs: number;
};

/**
 * At most ONE stage direction for the model, or null. Priority, highest first:
 * end_now › close_now › resume › stay_narrow / move_on for the active block. When the
 * highest-priority candidate was already sent for the same block inside
 * DIRECTIVE_DEDUPE_MS, nothing is sent (a lower-priority one would contradict it).
 */
export function decideDirective({ agenda, state, currentAttempt, nowMs }: DecideDirectiveInput): Directive | null {
  if (!agenda || !Array.isArray(agenda.blocks) || agenda.blocks.length === 0) return null;
  const candidate = pickDirective(agenda, state, currentAttempt, nowMs);
  if (!candidate) return null;
  const last = state.lastDirectiveMs[directiveKey(candidate.kind, candidate.block?.id ?? null)];
  if (last !== undefined && nowMs - last < DIRECTIVE_DEDUPE_MS) return null;
  return {
    id: `dir-${currentAttempt}-${Math.max(0, Math.trunc(nowMs)).toString(36)}-${candidate.kind}`,
    kind: candidate.kind,
    blockId: candidate.block?.id ?? null,
    text: directiveText(candidate.kind, candidate.block, candidate.from ?? null),
  };
}

type Candidate = { kind: DirectiveKind; block: AgendaBlock | null; from?: AgendaBlock | null };

function pickDirective(agenda: InterviewAgenda, state: DirectorState, currentAttempt: number, nowMs: number): Candidate | null {
  const blocks = blockIndex(agenda);
  const elapsed = state.elapsedMs;

  // 1. Past the hard cap by the grace: end.
  if (elapsed >= (agenda.hardCapMin + END_GRACE_MIN) * MINUTE_MS) return { kind: "end_now", block: null };

  // 2. The clock reached the close reserve and the closing has not started: skip to it.
  const active = state.activeBlockId ? (blocks.get(state.activeBlockId) ?? null) : null;
  const closingStarted =
    (active !== null && CLOSING_KINDS.has(active.kind)) ||
    state.begunBlockIds.some((id) => CLOSING_KINDS.has(blocks.get(id)?.kind as AgendaBlockKind));
  if (elapsed >= (agenda.hardCapMin - agenda.closeReserveMin) * MINUTE_MS && !closingStarted) {
    const closing = agenda.blocks.find((b) => CLOSING_KINDS.has(b.kind) && !state.coveredBlockIds.includes(b.id)) ?? null;
    return { kind: "close_now", block: closing };
  }

  // 3. First request of a reconnected attempt: tell the model where it is.
  if (currentAttempt > 1 && state.hasPriorAttemptEvents && !state.resumeSentThisAttempt) {
    return { kind: "resume", block: active ?? nextAgendaBlock(agenda, state, null) };
  }

  // 4. The active block's clock — coverage first, then the clock.
  if (!active) return null;
  const budget = budgetMs(active);
  if (budget === null) return null;
  const spent = state.spentMsByBlock[active.id] ?? 0;
  if (spent < budget) return null; // coverage first: never cut a topic before its budget

  const stayNarrowSent = state.stayNarrowBlockIds.includes(active.id);
  if (!NO_STAY_NARROW.has(active.kind) && !stayNarrowSent) return { kind: "stay_narrow", block: active };

  const overrun = spent - budget;
  const exhausted = overrun >= EXTENSION_SHARE * budget || slackMs(agenda, state) <= 0;
  if (!exhausted) return null;
  // Give a just-sent narrower question its minute before cutting the topic it asked for.
  const narrowAt = state.lastDirectiveMs[directiveKey("stay_narrow", active.id)];
  if (narrowAt !== undefined && nowMs - narrowAt < DIRECTIVE_DEDUPE_MS) return null;
  const next = nextAgendaBlock(agenda, state, active.id);
  return next ? { kind: "move_on", block: next, from: active } : null;
}

// ---- tools -----------------------------------------------------------------------------

export type DirectorToolCallInput = { callId: string; name: string; args: unknown };

/** Blocks whose coverage `end_interview("complete")` must wait for (they carry scored
 *  evidence). */
const SCORED_KINDS: ReadonlySet<AgendaBlockKind> = new Set<AgendaBlockKind>(["topic", "open"]);

/**
 * Whether a model-declared "complete" comes too early: a scored block is still
 * uncovered, the clock has not reached hardCap − closeReserve, and the closing block
 * has not begun. Returns the refusal (naming the block to continue with) or null when
 * "complete" is acceptable.
 */
export function prematureCompletion(
  agenda: InterviewAgenda,
  state: DirectorState,
): { remaining: number; blockId: string; toolResult: string } | null {
  const covered = new Set(state.coveredBlockIds);
  const uncovered = agenda.blocks.filter((b) => SCORED_KINDS.has(b.kind) && !covered.has(b.id));
  if (uncovered.length === 0) return null;
  if (state.elapsedMs >= (agenda.hardCapMin - agenda.closeReserveMin) * MINUTE_MS) return null;
  const begun = new Set(state.begunBlockIds);
  if (agenda.blocks.some((b) => b.kind === "close" && begun.has(b.id))) return null;
  // Continue with the active block when it is one of them; else the next one after it
  // in agenda order; else the first one.
  const activeIdx = state.activeBlockId === null ? -1 : agenda.blocks.findIndex((b) => b.id === state.activeBlockId);
  const next =
    uncovered.find((b) => b.id === state.activeBlockId) ??
    uncovered.find((b) => agenda.blocks.indexOf(b) > activeIdx) ??
    uncovered[0];
  const title = String(next.title ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const n = uncovered.length;
  return {
    remaining: n,
    blockId: next.id,
    toolResult: `Not yet — ${n} ${n === 1 ? "topic remains" : "topics remain"}. Continue with ${next.id}${title ? ` · ${title}` : ""}.`,
  };
}

export type DirectorToolOutcome = {
  /** Short English instruction handed back to the model as the tool's output. */
  toolResult: string;
  /** Events to persist (each carries the callId and this result, for replay). */
  events: DirectorEventDraft[];
  endCall: boolean;
};

export const TOOL_RESULT_CONTINUE = "Continue with the agenda.";

function argsObject(args: unknown): Record<string, unknown> | null {
  let value = args;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null; // a provider handing us unparseable arguments is a malformed call → "continue"
    }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function clampText(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export type ApplyDirectorToolInput = {
  tool: DirectorToolCallInput;
  agenda: InterviewAgenda | null;
  state: DirectorState;
  /** The candidate's persisted turns of this session, in order. */
  candidateTurnTexts: readonly string[];
};

/** Handle one tool call. Never throws; a malformed call answers TOOL_RESULT_CONTINUE. */
export function applyDirectorTool({ tool, agenda, state, candidateTurnTexts }: ApplyDirectorToolInput): DirectorToolOutcome {
  try {
    return applyDirectorToolUnsafe(tool, agenda, state, candidateTurnTexts);
  } catch {
    // The model is waiting on this result mid-sentence: a defect here must cost it
    // nothing but a nudge back to the agenda. The caller still logs nothing sensitive.
    return { toolResult: TOOL_RESULT_CONTINUE, events: [], endCall: false };
  }
}

function applyDirectorToolUnsafe(
  tool: DirectorToolCallInput,
  agenda: InterviewAgenda | null,
  state: DirectorState,
  candidateTurnTexts: readonly string[],
): DirectorToolOutcome {
  const callId = typeof tool?.callId === "string" ? tool.callId.slice(0, 200) : "";
  const cont: DirectorToolOutcome = { toolResult: TOOL_RESULT_CONTINUE, events: [], endCall: false };

  // A retried POST carries the same call: answer it the way it was answered, record nothing.
  if (callId && callId in state.toolResultsByCallId) {
    return { toolResult: state.toolResultsByCallId[callId], events: [], endCall: false };
  }
  const args = argsObject(tool?.args);
  if (!args) return cont;
  const blocks = blockIndex(agenda);
  const record = (kind: InterviewEventKind, blockId: string | null, payload: Record<string, unknown>, toolResult: string, endCall = false): DirectorToolOutcome => ({
    toolResult,
    events: [{ kind, blockId, payload: { ...payload, callId, toolResult } }],
    endCall,
  });

  switch (tool?.name) {
    case "begin_topic": {
      const blockId = typeof args.block_id === "string" ? args.block_id.trim() : "";
      if (!blocks.has(blockId)) return cont;
      if (state.coveredBlockIds.includes(blockId)) {
        return { toolResult: `Block ${blockId} is already covered. Continue with the next agenda block.`, events: [], endCall: false };
      }
      const result = `Recorded. Continue with block ${blockId}.`;
      if (state.activeBlockId === blockId) return { toolResult: result, events: [], endCall: false };
      return record("topic_begun", blockId, {}, result);
    }
    case "mark_topic_covered": {
      const blockId = typeof args.block_id === "string" ? args.block_id.trim() : "";
      if (!blocks.has(blockId)) return cont;
      if (state.coveredBlockIds.includes(blockId)) {
        return { toolResult: "Already recorded. Continue with the next agenda block.", events: [], endCall: false };
      }
      const raw = typeof args.evidence_quote === "string" ? args.evidence_quote.trim() : "";
      const reason =
        raw.length === 0
          ? "empty"
          : raw.length > MAX_EVIDENCE_QUOTE_CHARS
            ? "too_long"
            : normalizeQuoteText(raw).split(" ").filter(Boolean).length < MIN_EVIDENCE_QUOTE_WORDS
              ? "too_short"
              : matchQuoteToTurn(raw, candidateTurnTexts, EVIDENCE_QUOTE_MATCH) < 0
                ? "no_match"
                : null;
      const quote = raw.slice(0, MAX_EVIDENCE_QUOTE_CHARS);
      if (reason === null) {
        return record("topic_covered", blockId, { quote }, "Recorded. Close this topic and continue with the next agenda block.");
      }
      return record(
        "topic_cover_rejected",
        blockId,
        { quote, reason },
        "Not recorded: the quote must be the candidate's own words about a concrete instance. Ask one narrower question for a concrete instance, then try again.",
      );
    }
    case "report_guardrail": {
      const kind = typeof args.kind === "string" ? args.kind : "";
      if (!(GUARDRAIL_KINDS as readonly string[]).includes(kind)) return cont;
      const quote = clampText(args.quote, MAX_EVIDENCE_QUOTE_CHARS);
      // `verified` says only whether the quote is the candidate's persisted words. It is
      // an observation for the recruiter, never a score and never a reason to act.
      const verified = quote.length > 0 && matchQuoteToTurn(quote, candidateTurnTexts, EVIDENCE_QUOTE_MATCH) >= 0;
      return record(
        "guardrail",
        state.activeBlockId,
        { kind, quote, verified },
        "Recorded. Decline in one polite sentence and continue with the agenda.",
      );
    }
    case "forward_question": {
      const question = clampText(args.question, MAX_FORWARDED_QUESTION_CHARS);
      if (!question) return cont;
      return record(
        "candidate_question",
        state.activeBlockId,
        { question },
        "Recorded. Tell the candidate the recruiter will follow up, then continue with the agenda.",
      );
    }
    case "end_interview": {
      const reason = typeof args.reason === "string" ? args.reason : "";
      if (!(END_REASONS as readonly string[]).includes(reason)) return cont;
      // The interviewer LEADS, coverage first: the MODEL may not declare the interview
      // "complete" while scored topics are still open and the clock has not reached
      // the close reserve. `time` and `candidate_request` are NEVER refused — the
      // candidate may stop whenever they want; that is their right, not a leadership
      // question, and the clock's own end is the director's to call.
      if (reason === "complete" && agenda) {
        const early = prematureCompletion(agenda, state);
        if (early) {
          // Audited, not silent: an end_requested row marked `refused`, which the state
          // derivation ignores (it never sets endRequested) — the recruiter can still see
          // that the model tried to end early.
          return record("end_requested", state.activeBlockId, { reason, refused: true, remaining: early.remaining }, early.toolResult);
        }
      }
      return record(
        "end_requested",
        state.activeBlockId,
        { reason },
        "Recorded. Say your short closing line now; the call ends after it.",
        true,
      );
    }
    default:
      return cont;
  }
}
