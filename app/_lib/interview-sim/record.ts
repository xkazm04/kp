// One simulated conversation's RECORD, re-read for verdicts (spark interview-uat-tranche,
// WP-2) — pure. The dump holds two parallel records of the same call: the transcript
// (`turns`, what was said and every tool line, in `seq` order) and the director's
// `trace.events` (what it recorded, in record order). Verdicts need them joined on ONE
// timeline, and the engine makes the join exact without guessing from text:
//
//   - the k-th tool turn (role "system" with `tool`) carries callId `sim-k` (engine.ts
//     numbers every parsed call, well-formed or not), and every event a tool produced
//     carries that callId in its payload (voice/director.ts `record`);
//   - the k-th `director` turn is `trace.directives[k]`;
//   - the k-th candidate `turn` event is the k-th candidate turn the engine POSTED — only
//     a candidate cut off by the end handshake is recorded without being posted, and that
//     is always the last one.
//
// A turn's `seq` is the one clock every verdict compares on.

import type { DirectorEvent } from "../voice/director";
import type { SimConversationDump } from "./engine";
import type { SimTurn } from "./types";

export type ToolRecord = {
  seq: number;
  callId: string;
  /** The tool name as written, or "(unparsed)". */
  name: string;
  /** False when the tool line did not parse to a named call. */
  ok: boolean;
  args: Record<string, unknown> | null;
  result: string;
  /** The raw tool line. */
  raw: string;
  /** What the director recorded for this call (empty when it recorded nothing). */
  events: DirectorEvent[];
};

export type DirectiveRecord = { seq: number; kind: string; blockId: string | null; text: string };

export type CandidateTurnEvent = {
  event: DirectorEvent;
  /** The transcript turn this event records (null when the join could not be made). */
  turn: SimTurn | null;
};

export type SimRecord = {
  dump: SimConversationDump;
  /** Interviewer SPOKEN turns, in order. */
  spoken: SimTurn[];
  candidate: SimTurn[];
  tools: ToolRecord[];
  directives: DirectiveRecord[];
  events: DirectorEvent[];
  /** The director's candidate `turn` events, in record order, joined to their turns. */
  candidateEvents: CandidateTurnEvent[];
};

/** A tool's arguments as an object (a JSON string is parsed, like the director does). */
export function argsObject(args: unknown): Record<string, unknown> | null {
  let value = args;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null; // unparseable arguments: the director answered "continue", and so do we
    }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Join the transcript and the director's record (see the header). */
export function readRecord(dump: SimConversationDump): SimRecord {
  const turns = Array.isArray(dump.turns) ? dump.turns : [];
  const events = Array.isArray(dump.trace?.events) ? dump.trace.events : [];
  const directivesTrace = Array.isArray(dump.trace?.directives) ? dump.trace.directives : [];

  const byCall = new Map<string, DirectorEvent[]>();
  for (const e of events) {
    const callId = e.payload?.callId;
    if (typeof callId === "string") byCall.set(callId, [...(byCall.get(callId) ?? []), e]);
  }

  const tools: ToolRecord[] = [];
  const directives: DirectiveRecord[] = [];
  let k = 0;
  let d = 0;
  for (const t of turns) {
    if (t.role === "system" && t.tool) {
      k += 1;
      const callId = `sim-${k}`;
      const name = String(t.tool.name ?? "(unparsed)");
      tools.push({
        seq: t.seq,
        callId,
        name,
        ok: name !== "(unparsed)",
        args: argsObject(t.tool.args),
        result: String(t.tool.result ?? ""),
        raw: t.text,
        events: byCall.get(callId) ?? [],
      });
    } else if (t.role === "director") {
      const trace = directivesTrace[d];
      d += 1;
      directives.push({ seq: t.seq, kind: trace?.kind ?? "unknown", blockId: trace?.blockId ?? null, text: t.text });
    }
  }

  const candidate = turns.filter((t) => t.role === "candidate");
  const candEvents = events.filter((e) => e.kind === "turn" && e.payload?.role === "candidate");
  const candidateEvents = candEvents.map((event, i) => {
    const turn = candidate[i] ?? null;
    const text = typeof event.payload?.text === "string" ? squash(event.payload.text) : "";
    // The event text is the turn clamped at 4000 characters: a prefix match is the join.
    const joined = turn && text && squash(turn.text).startsWith(text.slice(0, 200)) ? turn : null;
    return { event, turn: joined };
  });

  return {
    dump,
    spoken: turns.filter((t) => t.role === "interviewer"),
    candidate,
    tools,
    directives,
    events,
    candidateEvents,
  };
}

/** The window "within N interviewer turns after `afterSeq`": everything up to and
 *  including the N-th interviewer spoken turn after it (a reply's tool lines are recorded
 *  before its words, so they fall inside). `complete` is false when the call ended first. */
export function windowAfter(rec: SimRecord, afterSeq: number, n: number): { end: number; complete: boolean } {
  const after = rec.spoken.filter((t) => t.seq > afterSeq);
  if (after.length >= n) return { end: after[n - 1].seq, complete: true };
  return { end: Number.POSITIVE_INFINITY, complete: false };
}

/** Accepted (not refused) end requests, with the tool turn that made them. */
export function acceptedEnds(rec: SimRecord): { tool: ToolRecord; reason: string }[] {
  const out: { tool: ToolRecord; reason: string }[] = [];
  for (const t of rec.tools) {
    const e = t.events.find((x) => x.kind === "end_requested" && x.payload?.refused !== true);
    if (e) out.push({ tool: t, reason: String(e.payload?.reason ?? "") });
  }
  return out;
}

/** The block ids begun, each with the tool turn whose `topic_begun` recorded it. */
export function begunBlocks(rec: SimRecord): { tool: ToolRecord; blockId: string }[] {
  const out: { tool: ToolRecord; blockId: string }[] = [];
  for (const t of rec.tools) for (const e of t.events) if (e.kind === "topic_begun" && e.blockId) out.push({ tool: t, blockId: e.blockId });
  return out;
}

/** The `transcript:<runId>/<situationId>` reference of a whole conversation. */
export function conversationRef(runId: string, situationId: string): string {
  return `transcript:${runId}/${situationId}`;
}

/** The `transcript:<runId>/<situationId>#<seq>` reference a finding cites. */
export function transcriptRef(runId: string, situationId: string, seq: number): string {
  return `${conversationRef(runId, situationId)}#${seq}`;
}

/** A turn's text trimmed to a quotable excerpt. */
export function excerpt(text: string, max = 240): string {
  const t = squash(String(text ?? ""));
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}
