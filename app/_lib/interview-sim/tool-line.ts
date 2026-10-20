// The TEXT stand-in's tool channel (spark interview-uat-tranche, WP-1).
//
// Production providers call the director's tools through native function calling. The
// Claude CLI has none, so the stand-in interviewer writes a tool call as a line of its
// own — `<<tool {"name":"begin_topic","args":{"block_id":"b1"}}>>` (types.ts
// SIM_TOOL_LINE) — and this module takes a reply apart into what is SPOKEN and what is
// CALLED. The candidate simulator only ever receives the spoken part.
//
// LENIENT BY DESIGN, and a superset of SIM_TOOL_LINE: every line the contract regex
// matches is a call here, and so is a call written inline mid-sentence or two calls on
// one line (a stand-in's protocol slip must never leak tool syntax into the candidate's
// ear — that would test the harness, not the interviewer). A call whose JSON does not
// parse is still stripped and still answered, the way production answers a malformed
// function call: "Continue with the agenda." (voice/director.ts TOOL_RESULT_CONTINUE).
//
// Two more harness artifacts are cut from the spoken text, each with a note so nothing
// disappears silently: a fabricated `<<result …>>` line (the model inventing a tool's
// answer) and a line the stand-in wrote FOR the other party (`Candidate: …` in an
// interviewer reply) — a realtime model cannot speak the candidate's words, so a text
// model doing it is a role-play artifact, not interviewer behaviour.

import { MAX_PAUSE_MS } from "./clock";

/** One tool call as written by the stand-in. `ok` is false when the JSON could not be
 *  read or carries no usable name; `name`/`args` are then best-effort. */
export type ParsedToolCall = {
  /** The exact `<<tool …>>` text as written. */
  raw: string;
  name: string | null;
  args: unknown;
  ok: boolean;
};

export type ParsedInterviewerReply = {
  /** What the candidate hears: the reply minus every tool call and harness artifact. */
  spoken: string;
  calls: ParsedToolCall[];
  /** One line per harness artifact that was cut (for the conversation's system notes). */
  notes: string[];
};

const TOOL_OPEN = "<<tool";

/** Index just past the balanced JSON object starting at `start` (which must be `{`),
 *  honouring strings and escapes; -1 when it never closes. */
function endOfJsonObject(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function readCall(json: string): { name: string | null; args: unknown; ok: boolean } {
  try {
    const value = JSON.parse(json) as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) return { name: null, args: null, ok: false };
    const v = value as { name?: unknown; args?: unknown; arguments?: unknown };
    const name = typeof v.name === "string" && v.name.trim() !== "" ? v.name.trim() : null;
    return { name, args: v.args ?? v.arguments ?? {}, ok: name !== null };
  } catch {
    return { name: null, args: null, ok: false }; // unparseable → answered "continue", like a malformed function call
  }
}

/** Every `<<tool …>>` occurrence in `text`, in order, with its span. */
function findCalls(text: string): { start: number; end: number; call: ParsedToolCall }[] {
  const out: { start: number; end: number; call: ParsedToolCall }[] = [];
  let from = 0;
  while (from < text.length) {
    const start = text.indexOf(TOOL_OPEN, from);
    if (start < 0) break;
    let cursor = start + TOOL_OPEN.length;
    while (cursor < text.length && /[ \t]/.test(text[cursor])) cursor += 1;
    let end: number;
    let parsed: { name: string | null; args: unknown; ok: boolean };
    const jsonEnd = text[cursor] === "{" ? endOfJsonObject(text, cursor) : -1;
    if (jsonEnd > 0 && text.startsWith(">>", jsonEnd)) {
      parsed = readCall(text.slice(cursor, jsonEnd));
      end = jsonEnd + 2;
    } else {
      // Not the protocol's shape (`<<tool begin_topic b1>>`, an unclosed object): strip
      // through the next `>>` on the same line, or to the end of the line.
      const lineEnd = text.indexOf("\n", start);
      const stop = lineEnd < 0 ? text.length : lineEnd;
      const close = text.indexOf(">>", cursor);
      end = close >= 0 && close < stop ? close + 2 : stop;
      parsed = { name: null, args: null, ok: false };
    }
    out.push({ start, end, call: { raw: text.slice(start, end).trim(), ...parsed } });
    from = end;
  }
  return out;
}

const RESULT_ECHO = /<<result\b[^\n]*/g;
const INTERVIEWER_LABEL = /^\s*(?:\*\*)?(?:AI\s+)?Interviewer(?:\*\*)?\s*:\s*/i;
const OTHER_PARTY_LINE = /^\s*(?:\*\*)?Candidate(?:\*\*)?\s*:/im;

function tidy(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Take an interviewer reply apart into spoken text and tool calls. */
export function parseInterviewerReply(reply: string): ParsedInterviewerReply {
  const notes: string[] = [];
  let text = String(reply ?? "").replace(/\r\n/g, "\n");
  const other = OTHER_PARTY_LINE.exec(text);
  if (other) {
    notes.push(`harness: cut a line the interviewer wrote for the candidate: ${JSON.stringify(text.slice(other.index).trim().slice(0, 200))}`);
    text = text.slice(0, other.index);
  }
  const found = findCalls(text);
  let spoken = "";
  let cursor = 0;
  for (const f of found) {
    spoken += text.slice(cursor, f.start);
    cursor = f.end;
  }
  spoken += text.slice(cursor);
  if (spoken.includes("<<result")) {
    notes.push("harness: cut a tool result the interviewer wrote itself");
    spoken = spoken.replace(RESULT_ECHO, "");
  }
  spoken = tidy(spoken).replace(INTERVIEWER_LABEL, "");
  return { spoken: tidy(spoken), calls: found.map((f) => f.call), notes };
}

/** The tool lines of a reply, in order — what the interviewer's own context keeps of a
 *  reply whose words were withheld (production: the function calls stay in the
 *  conversation, the unspoken audio never existed). */
export function toolLinesOf(parsed: ParsedInterviewerReply): string {
  return parsed.calls.map((c) => c.raw).join("\n");
}

/** How a director tool result is rendered back to the stand-in interviewer: the EXACT
 *  string the director returned, behind a label naming the tool it answers. */
export function toolResultLine(name: string | null, result: string): string {
  return `<<result ${name ?? "unknown"}>> ${result}`;
}

// ---- the candidate side -------------------------------------------------------------

export type ParsedCandidateReply = {
  /** What the candidate says out loud ("" = said nothing). */
  spoken: string;
  /** Silence before the words (or instead of them), from `<<pause N>>` tokens. */
  pauseMs: number;
  notes: string[];
};

/** `<<pause N>>` as the harness asks — and the variants a model writes when it
 *  paraphrases the protocol (`<pause 8>`, `[pause 8s]`, `(pause 8 seconds)`), seen in the
 *  first live smoke: an unrecognised token would reach the transcript as speech. */
const PAUSE_TOKEN = /(?:<<|<|\[|\()\s*pause\s+(\d+(?:\.\d+)?)\s*(?:s|secs?|seconds?)?\s*(?:>>|>|\]|\))/gi;
const CANDIDATE_LABEL = /^\s*(?:\*\*)?Candidate(?:\*\*)?\s*:\s*/i;
const INTERVIEWER_LINE = /^\s*(?:\*\*)?(?:AI\s+)?Interviewer(?:\*\*)?\s*:/im;

/** Take a candidate reply apart into spoken words and silence. */
export function parseCandidateReply(reply: string): ParsedCandidateReply {
  const notes: string[] = [];
  let text = String(reply ?? "").replace(/\r\n/g, "\n");
  const other = INTERVIEWER_LINE.exec(text);
  if (other && other.index > 0) {
    notes.push(`harness: cut a line the candidate wrote for the interviewer: ${JSON.stringify(text.slice(other.index).trim().slice(0, 200))}`);
    text = text.slice(0, other.index);
  }
  let pauseMs = 0;
  text = text.replace(PAUSE_TOKEN, (_m, n: string) => {
    pauseMs += Math.round(Number(n) * 1000);
    return " ";
  });
  // Any other harness-shaped token the candidate wrote is not speech either.
  text = text.replace(/<<[^>\n]*>>/g, " ");
  const spoken = tidy(text.replace(/[ \t]{2,}/g, " ")).replace(CANDIDATE_LABEL, "");
  return { spoken: tidy(spoken), pauseMs: Math.min(pauseMs, MAX_PAUSE_MS), notes };
}
