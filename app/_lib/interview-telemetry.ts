import type { VoiceTurn } from "./voice/types";

// Deterministic call telemetry for the agentic interview — the instrumentation
// half of "build the live case, instrument heavily, discover what predicts".
// Everything here is a PROXY computed from the transcript (turn counts, word
// shares, timestamp gaps, hint-token references), not a measurement of latent
// ability; the point is to persist raw, honest signals alongside each scorecard
// so potential_score's weights can eventually be validated against outcomes
// instead of staying judgment-only. Pure and side-effect-free — pinned by
// interview-telemetry.test.ts.

export type HintUptake = "integrated" | "acknowledged" | "missed" | "not_offered";

export type InterviewTelemetry = {
  version: 1;
  turns: number;
  candidateTurns: number;
  interviewerTurns: number;
  candidateWords: number;
  interviewerWords: number;
  /** Candidate share of all words, 0..1 (null when nobody said anything). */
  talkRatio: number | null;
  /** First→last stamped turn, seconds (null without timestamps). */
  durationSec: number | null;
  /** Longest interviewer→candidate response gap, seconds — the time-to-recovery
   *  proxy: a long stall after a hard probe is signal the scorecard can't see. */
  longestResponseGapSec: number | null;
  hint: {
    /** Whether the scripted coachability hint was detectably delivered. */
    offered: boolean;
    /** Transcript index of the hint turn (null when not offered/found). */
    turnIndex: number | null;
    /** integrated — the candidate worked the hint's substance into a substantive
     *  answer; acknowledged — mentioned it briefly; missed — never referenced it;
     *  not_offered — no hint was scripted or it was never detectably spoken. */
    uptake: HintUptake;
    /** Seconds from the hint to the candidate's next turn (null without timestamps). */
    responseSec: number | null;
  };
};

/** Tokens too generic to count as "referencing the hint". Tokens shorter than
 *  4 chars are dropped wholesale, so this only needs the long generic ones. */
const STOPWORDS = new Set([
  "have", "that", "this", "with", "what", "ever", "same", "could", "would",
  "should", "about", "they", "them", "then", "from", "your", "there", "where",
  "when", "case", "consider", "considered", "maybe", "might", "think",
]);

const words = (text: string): string[] => text.split(/\s+/).filter(Boolean);

/** Content tokens of a phrase: lowercase, punctuation-stripped, ≥4 chars, minus
 *  stopwords — the vocabulary a later turn must reuse to count as a reference. */
function contentTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 4 && !STOPWORDS.has(t))
  );
}

/** The spoken line inside a scripted probe: coachability probes read like
 *  ‘Mid-discussion, offer ONE gentle hint: “Could the same event arrive
 *  twice?”’ — the candidate only ever hears the quoted part, so that is what
 *  transcript matching must key on. Falls back to the whole probe when nothing
 *  is quoted. */
export function hintLineFromProbe(probe: string | null | undefined): string | null {
  if (!probe || !probe.trim()) return null;
  const quoted = /[“"]([^”"]+)[”"]/.exec(probe);
  return (quoted?.[1] ?? probe).trim();
}

const parseAt = (turn: VoiceTurn): number | null => {
  if (!turn.at) return null;
  const ms = Date.parse(turn.at);
  return Number.isNaN(ms) ? null : ms;
};

/** A candidate turn long enough to be a worked answer rather than a filler. */
const SUBSTANTIVE_WORDS = 25;
/** Minimum hint-vocabulary overlap for a turn to count as referencing the hint. */
const MIN_HINT_TOKENS = 2;

export function extractTelemetry(
  transcript: VoiceTurn[],
  opts?: { hintText?: string | null }
): InterviewTelemetry {
  const turns = transcript.filter((t) => t.role !== "system");
  const candidate = turns.filter((t) => t.role === "candidate");
  const interviewer = turns.filter((t) => t.role === "interviewer");
  const candidateWords = candidate.reduce((n, t) => n + words(t.text).length, 0);
  const interviewerWords = interviewer.reduce((n, t) => n + words(t.text).length, 0);
  const totalWords = candidateWords + interviewerWords;

  // first→last stamped turn
  const stamps = turns.map(parseAt).filter((ms): ms is number => ms !== null);
  const durationSec = stamps.length >= 2 ? Math.round((Math.max(...stamps) - Math.min(...stamps)) / 1000) : null;

  // longest interviewer→next-candidate gap (time-to-recovery proxy)
  let longestGapMs: number | null = null;
  for (let i = 0; i < turns.length - 1; i += 1) {
    if (turns[i].role !== "interviewer" || turns[i + 1].role !== "candidate") continue;
    const a = parseAt(turns[i]);
    const b = parseAt(turns[i + 1]);
    if (a === null || b === null || b < a) continue;
    if (longestGapMs === null || b - a > longestGapMs) longestGapMs = b - a;
  }

  // ---- hint delivery + uptake ----
  const hintLine = hintLineFromProbe(opts?.hintText);
  const hintTokens = hintLine ? contentTokens(hintLine) : new Set<string>();
  let hintIndex: number | null = null;
  if (hintTokens.size > 0) {
    // The hint turn is the interviewer turn reusing the most hint vocabulary —
    // requiring at least MIN_HINT_TOKENS so an unrelated question never matches.
    let best = MIN_HINT_TOKENS - 1;
    turns.forEach((t, i) => {
      if (t.role !== "interviewer") return;
      const overlap = [...contentTokens(t.text)].filter((tok) => hintTokens.has(tok)).length;
      if (overlap > best) {
        best = overlap;
        hintIndex = i;
      }
    });
  }

  let uptake: HintUptake = "not_offered";
  let responseSec: number | null = null;
  if (hintIndex !== null) {
    uptake = "missed";
    const after = turns.slice(hintIndex + 1).filter((t) => t.role === "candidate");
    const referencing = after.filter(
      (t) => [...contentTokens(t.text)].filter((tok) => hintTokens.has(tok)).length >= MIN_HINT_TOKENS
    );
    if (referencing.length > 0) {
      const substantive = referencing.some((t) => words(t.text).length >= SUBSTANTIVE_WORDS);
      uptake = substantive || referencing.length >= 2 ? "integrated" : "acknowledged";
    }
    const hintAt = parseAt(turns[hintIndex]);
    const next = turns.slice(hintIndex + 1).find((t) => t.role === "candidate");
    const nextAt = next ? parseAt(next) : null;
    if (hintAt !== null && nextAt !== null && nextAt >= hintAt) responseSec = Math.round((nextAt - hintAt) / 1000);
  }

  return {
    version: 1,
    turns: turns.length,
    candidateTurns: candidate.length,
    interviewerTurns: interviewer.length,
    candidateWords,
    interviewerWords,
    talkRatio: totalWords > 0 ? Math.round((candidateWords / totalWords) * 100) / 100 : null,
    durationSec,
    longestResponseGapSec: longestGapMs === null ? null : Math.round(longestGapMs / 1000),
    hint: { offered: hintIndex !== null, turnIndex: hintIndex, uptake, responseSec },
  };
}
