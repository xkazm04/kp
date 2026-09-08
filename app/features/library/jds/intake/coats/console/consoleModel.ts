// THE CONSOLE COAT's own reading of the session — pure, JSX-free, so the rail,
// the stage and the desk can all agree about "which turn is current" without
// importing each other (the `coatKit` shape one directory up).
//
// The classic desk renders the transcript as a scrolling log: the live question
// is the last bubble and is typographically identical to the nineteen before it.
// Console inverts that — ONE question is the hero and everything earlier is a
// tick on a rail — and inverting it needs a structure the flat turn array does
// not have: the EXCHANGE. An agent turn opens one, the requestor's next turn
// closes it, and the system turns that follow ride along as the seams they are.
//
// The second thing this file owns is the split the craft doc asks for: one
// question per turn, with a reflection before it. The engine writes both in one
// turn, so the stage has to separate them to give them different weight — the
// reflection quiet above, the question at reading size. `splitPrompt` is the
// rule, and it is here rather than in the component because it is a guess about
// prose and a guess belongs somewhere it can be read and corrected.

import { compactedTurnCount } from "@/app/_lib/intake-transcript";
import type { IntakeChoiceSet } from "@/app/_lib/intake-choices";
import type { IntakeTurn } from "../../jdsIntakeLogic";

/** The house spring (AnalyzeWorkspace / PipelineMotion / IntakeArrivalMotion). */
export const CONSOLE_SPRING = { type: "spring" as const, stiffness: 420, damping: 34 };
/** The house ease, for the duration-based half (unfolds, crossfades). */
export const CONSOLE_EASE = [0.16, 1, 0.3, 1] as const;
/** Card landing: 40 ms apart, first dozen only — a cue, not a loading bar. */
export const CONSOLE_STAGGER_MS = 40;
export const CONSOLE_STAGGER_CAP = 12;

/** This coat's OWN zone-fold memory. Never the triptych's key: the two coats
 *  have different zones and one would silently fold the other's. */
export const CONSOLE_COLUMNS_KEY = "kp-intake-console-cols";

export type ConsoleExchange = {
  /** Transcript index of the agent turn — the id `highlightTurn` addresses. */
  index: number;
  /** The quiet half: what the agent understood before it asked. */
  reflection: string | null;
  /** The half that gets the display face. */
  question: string;
  /** >0 when this turn is the compaction MARKER rather than a question; the
   *  stage renders the disclosure instead of prose. */
  compacted: number;
  /** The requestor's reply, once it exists. */
  answer: string | null;
  answerIndex: number | null;
  choices: IntakeChoiceSet | null;
  /** System turns recorded after this exchange (a re-open note, a seam). */
  notes: string[];
};

/**
 * Split one agent turn into "what it understood" and "what it is asking".
 *
 * Two rules, in order. A turn written as several PARAGRAPHS puts its question
 * last — that is how the engine writes when it writes both, so the paragraph
 * boundary is taken at face value. A single paragraph is split at the last
 * sentence that asks something: everything up to that sentence is reflection.
 * A turn with neither shape is all question, which is the honest answer — a
 * reflection invented out of the first half of a sentence would be worse than
 * none.
 */
export function splitPrompt(text: string): { reflection: string | null; question: string } {
  const body = text.trim();
  if (!body) return { reflection: null, question: "" };

  const paras = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paras.length > 1) {
    return { reflection: paras.slice(0, -1).join("\n\n"), question: paras[paras.length - 1] ?? body };
  }

  const mark = body.lastIndexOf("?");
  if (mark < 0) return { reflection: null, question: body };
  const before = body.slice(0, mark);
  const start = Math.max(before.lastIndexOf(". "), before.lastIndexOf("! "), before.lastIndexOf("? "));
  if (start < 0) return { reflection: null, question: body };
  const question = body.slice(start + 2).trim();
  const reflection = body.slice(0, start + 1).trim();
  if (!question || !reflection) return { reflection: null, question: body };
  return { reflection, question };
}

/**
 * The transcript as exchanges, oldest first.
 *
 * A candidate turn with no agent turn before it cannot happen through the
 * composer (the session always opens with the agent), but the voice plane can
 * fold a recovered utterance in — so a leading answer opens a headless exchange
 * rather than being dropped. Silence is not a repair.
 */
export function buildExchanges(transcript: readonly IntakeTurn[]): ConsoleExchange[] {
  const out: ConsoleExchange[] = [];
  transcript.forEach((turn, index) => {
    if (turn.role === "interviewer") {
      const compacted = compactedTurnCount(turn);
      const split = compacted > 0 ? { reflection: null, question: "" } : splitPrompt(turn.text);
      out.push({
        index,
        reflection: split.reflection,
        question: split.question,
        compacted,
        answer: null,
        answerIndex: null,
        choices: turn.choices ?? null,
        notes: [],
      });
      return;
    }
    const open = out[out.length - 1];
    if (turn.role === "system") {
      if (open) open.notes.push(turn.text);
      else out.push({ index, reflection: null, question: "", compacted: 0, answer: null, answerIndex: null, choices: null, notes: [turn.text] });
      return;
    }
    // A requestor turn. It answers the open exchange unless that one is already
    // answered — two answers in a row (voice recovery) start a new headless one.
    if (open && open.answer === null) {
      open.answer = turn.text;
      open.answerIndex = index;
      return;
    }
    out.push({ index, reflection: null, question: "", compacted: 0, answer: turn.text, answerIndex: index, choices: null, notes: [] });
  });
  return out;
}

/** Which exchange is the HERO: the newest one that actually asked something.
 *  Null on a transcript that has not produced a question yet. */
export function currentExchange(exchanges: readonly ConsoleExchange[]): ConsoleExchange | null {
  for (let i = exchanges.length - 1; i >= 0; i -= 1) {
    const ex = exchanges[i];
    if (ex && (ex.question || ex.compacted > 0)) return ex;
  }
  return null;
}

/** The exchange a brief citation points into — `sourceTurn` is a transcript
 *  index and may address either half of an exchange. */
export function exchangeForTurn(exchanges: readonly ConsoleExchange[], turn: number): ConsoleExchange | null {
  return exchanges.find((ex) => ex.index === turn || ex.answerIndex === turn) ?? null;
}
