// CHARACTER FIRST-PERSON VOICES over simulated interviews (spark interview-uat-tranche,
// WP-2) — the optional /uat "felt verdict" layer: a Character from the repo's uat/
// overlay reads the transcripts of the situations whose behaviour it plausibly performs,
// CANDIDATE-SIDE (only what the candidate heard and said — no tool lines, no producer
// notes), and answers in its own voice plus its "Conversation criteria" checklist.
//
// The Character file declares, in its frontmatter, `sim_behaviours: [<behaviour>, …]`
// (which bank behaviours it plausibly performs) and optionally `language`, and carries a
// `## Conversation criteria` section (a checklist). A file missing either is skipped and
// the run says so — the overlay is gitignored and adding them is not this module's job.
//
// Citations are verified like the judge's: a criterion's pass or fail must cite
// `transcript:<runId>/<situationId>#<seq>` with a quote that is in that turn; an
// unverifiable criterion is reported as "n/a (evidence did not verify)". The voice model
// is the judge's (never the interviewer's).

import type { SimConversationDump } from "./engine";
import { quoteVerifies } from "./judge";
import { conversationRef, excerpt } from "./record";
import type { SimLlm, SimSituation } from "./types";

export type CharacterFile = {
  path: string;
  /** The file's `name` frontmatter, else its basename. */
  name: string;
  displayName: string;
  language: string | null;
  simBehaviours: string[] | null;
  criteria: string[] | null;
  raw: string;
};

/** A tiny YAML-frontmatter reader: `key: value`, `key: [a, b]` and `key:` + `- item` lists. */
export function readFrontmatter(text: string): { data: Record<string, string | string[]>; body: string } {
  const t = text.replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(t);
  if (!m) return { data: {}, body: t };
  const data: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  const clean = (v: string) => v.trim().replace(/^["']|["']$/g, "");
  for (const line of m[1].split("\n")) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (data[listKey] as string[]).push(clean(item[1]));
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, value] = kv;
    if (value === "") {
      data[key] = [];
      listKey = key;
    } else if (/^\[.*\]$/.test(value.trim())) {
      data[key] = value.trim().slice(1, -1).split(",").map(clean).filter(Boolean);
      listKey = null;
    } else {
      data[key] = clean(value);
      listKey = null;
    }
  }
  return { data, body: t.slice(m[0].length) };
}

/** The checklist under a `## Conversation criteria` heading, or null when there is none. */
export function conversationCriteria(body: string): string[] | null {
  const m = /^##\s+Conversation criteria\s*$/im.exec(body);
  if (!m) return null;
  const rest = body.slice(m.index + m[0].length);
  const next = /^##\s+/m.exec(rest);
  const section = next ? rest.slice(0, next.index) : rest;
  const items = section
    .split("\n")
    .map((l) => /^\s*(?:[-*]|\d+\.)\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(l)?.[1]?.trim())
    .filter((x): x is string => Boolean(x));
  return items.length ? items : null;
}

export function parseCharacter(filePath: string, text: string): CharacterFile {
  const { data, body } = readFrontmatter(text);
  const base = filePath.replace(/\\/g, "/").split("/").pop()?.replace(/\.md$/i, "") ?? "character";
  const str = (k: string) => (typeof data[k] === "string" ? (data[k] as string) : null);
  const list = (k: string) => (Array.isArray(data[k]) ? (data[k] as string[]) : typeof data[k] === "string" ? [data[k] as string] : null);
  return {
    path: filePath,
    name: str("name") ?? base,
    displayName: str("character") ?? str("name") ?? base,
    language: str("language"),
    simBehaviours: list("sim_behaviours"),
    criteria: conversationCriteria(body),
    raw: text,
  };
}

/** Why a Character cannot give a voice, or null. */
export function characterProblem(c: CharacterFile): string | null {
  if (!c.simBehaviours || c.simBehaviours.length === 0) return "no `sim_behaviours` in its frontmatter";
  if (!c.criteria) return "no `## Conversation criteria` section";
  return null;
}

/** Whether a conversation belongs to a Character: its behaviour is claimed, and the
 *  language matches when the Character declares one. */
export function characterClaims(c: Pick<CharacterFile, "simBehaviours" | "language">, s: Pick<SimSituation, "behaviour" | "language">): boolean {
  if (!c.simBehaviours?.includes(s.behaviour)) return false;
  return !c.language || c.language === s.language;
}

export type VoiceConversation = { dump: SimConversationDump; situation: SimSituation };

/** What the candidate heard and said — nothing else. */
export function renderCandidateSide(dump: SimConversationDump): string {
  return dump.turns
    .filter((t) => t.role === "interviewer" || t.role === "candidate")
    .map((t) => `[${t.seq}] ${t.role === "interviewer" ? "Interviewer" : "Candidate"}: ${t.text}`)
    .join("\n");
}

export const VOICE_SYSTEM = [
  "You are the person described in the CHARACTER file the user gives you. You are reading transcripts of first-round job interviews run by an AI interviewer, in which the candidate behaved the way you sometimes do. Read each as if you had been that candidate: you know only what is in it.",
  "Reply with ONLY one JSON object and nothing else:",
  '{"verdict":"<4 to 8 sentences, first person, in your own voice: how the interviewer treated you, what you trusted or did not, whether you would go through it again>","criteria":[{"id":"c1","result":"pass","evidence":[{"ref":"transcript:<run>/<situation>#<turn>","quote":"<words copied exactly from that turn>"}]}]}',
  "Answer every criterion id once. result is pass, fail or n/a (n/a when the transcripts never test it). A pass or a fail must cite at least one turn, with a quote copied exactly from it.",
].join("\n");

export function buildVoicePrompt(c: CharacterFile, convs: readonly VoiceConversation[]): { system: string; user: string } {
  const criteria = (c.criteria ?? []).map((text, i) => `- c${i + 1}: ${text}`).join("\n");
  const transcripts = convs.map((v) => `### ${conversationRef(v.dump.runId, v.dump.situationId)}\n${renderCandidateSide(v.dump)}`).join("\n\n");
  const user = ["CHARACTER", c.raw.trim(), "", "CRITERIA (id: criterion)", criteria, "", "TRANSCRIPTS", transcripts].join("\n");
  return { system: VOICE_SYSTEM, user };
}

export type VoiceCriterion = { id: string; text: string; result: "pass" | "fail" | "n/a"; evidence: string[]; note?: string };
export type VoiceResult = {
  character: string;
  displayName: string;
  path: string;
  status: "ok" | "skipped" | "malformed" | "error";
  reason?: string;
  voiceId?: string;
  refs: string[];
  verdict?: string;
  criteria: VoiceCriterion[];
};

type RawCriterion = { id?: unknown; result?: unknown; evidence?: unknown };

function parseVoice(text: string): { verdict: string; criteria: RawCriterion[] } | null {
  const t = String(text ?? "");
  const body = /```(?:json)?\s*([\s\S]*?)```/i.exec(t)?.[1] ?? t;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(body.slice(start, end + 1)) as { verdict?: unknown; criteria?: unknown };
    if (typeof v.verdict !== "string" || !Array.isArray(v.criteria)) return null;
    return { verdict: v.verdict, criteria: v.criteria as RawCriterion[] };
  } catch {
    return null; // not JSON — reported as a malformed voice, never guessed at
  }
}

/** Verify one cited `{ ref, quote }` against the conversations shown. */
function citationVerifies(e: unknown, convs: readonly VoiceConversation[]): string | null {
  if (!e || typeof e !== "object") return null;
  const { ref, quote } = e as { ref?: unknown; quote?: unknown };
  if (typeof ref !== "string" || typeof quote !== "string") return null;
  const m = /^transcript:([^/]+)\/(.+)#(\d+)$/.exec(ref.trim());
  if (!m) return null;
  const conv = convs.find((v) => v.dump.runId === m[1] && v.dump.situationId === m[2]);
  const turn = conv?.dump.turns.find((t) => t.seq === Number(m[3]) && (t.role === "interviewer" || t.role === "candidate"));
  return turn && quoteVerifies(quote, turn.text) ? ref.trim() : null;
}

/** One Character's voice over its conversations (one model call). Never throws. */
export async function characterVoice(c: CharacterFile, convs: readonly VoiceConversation[], llm: SimLlm): Promise<VoiceResult> {
  const base = { character: c.name, displayName: c.displayName, path: c.path, refs: convs.map((v) => conversationRef(v.dump.runId, v.dump.situationId)), criteria: [] as VoiceCriterion[] };
  const problem = characterProblem(c);
  if (problem) return { ...base, status: "skipped", reason: problem };
  if (convs.length === 0) return { ...base, status: "skipped", reason: `no conversation of its behaviours (${(c.simBehaviours ?? []).join(", ")})${c.language ? ` in ${c.language}` : ""}` };
  const { system, user } = buildVoicePrompt(c, convs);
  let reply: string;
  try {
    reply = await llm.complete({ system, messages: [{ role: "user", content: user }] });
  } catch (err) {
    return { ...base, status: "error", voiceId: llm.id, reason: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
  }
  const parsed = parseVoice(reply);
  if (!parsed) return { ...base, status: "malformed", voiceId: llm.id, reason: "the voice's reply was not the JSON asked for" };
  const criteria: VoiceCriterion[] = (c.criteria ?? []).map((text, i) => {
    const id = `c${i + 1}`;
    const raw = parsed.criteria.find((x) => x?.id === id);
    const result = raw?.result === "pass" || raw?.result === "fail" ? raw.result : "n/a";
    if (result === "n/a") return { id, text, result, evidence: [] };
    const cited = Array.isArray(raw?.evidence) ? (raw?.evidence as unknown[]) : [];
    const verified = cited.map((e) => citationVerifies(e, convs)).filter((x): x is string => x !== null);
    if (verified.length === 0) return { id, text, result: "n/a", evidence: [], note: `${result} claimed; evidence did not verify` };
    return { id, text, result, evidence: verified };
  });
  return { ...base, status: "ok", voiceId: llm.id, verdict: parsed.verdict.trim(), criteria };
}

export function renderVoiceMarkdown(v: VoiceResult): string {
  const lines = [`# ${v.displayName} — first-person verdict (simulated, LC)`, ""];
  lines.push(`Character file: \`${v.path}\` · voice model: ${v.voiceId ?? "—"} · status: ${v.status}${v.reason ? ` (${v.reason})` : ""}`);
  lines.push("", `Conversations read (candidate-side only): ${v.refs.length ? v.refs.map((r) => `\`${r}\``).join(", ") : "none"}`, "");
  if (v.verdict) lines.push(...v.verdict.split("\n").map((l) => `> ${l}`), "");
  if (v.criteria.length) {
    lines.push("## Conversation criteria", "", "| # | Criterion | Result | Evidence |", "| --- | --- | --- | --- |");
    for (const c of v.criteria) {
      const result = c.note ? `n/a (evidence did not verify — ${c.note})` : c.result;
      lines.push(`| ${c.id} | ${excerpt(c.text, 160).replace(/\|/g, "\\|")} | ${result} | ${c.evidence.map((e) => `\`${e}\``).join(", ") || "—"} |`);
    }
    lines.push("");
  }
  lines.push("A simulated candidate's transcript read by a model in this Character's voice: a felt verdict for the /uat panel, never a measurement of real candidates.", "");
  return lines.join("\n");
}
