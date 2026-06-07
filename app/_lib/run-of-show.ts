// The run-of-show timing contract for the interview-prep plan.
//
// The plan is pinned to a documented 15–30 minute band. Its shape is:
//   intro (fixed) + one block per CV-derived question + wrap (fixed),
// with an optional "open discussion" block that absorbs slack so a SPARSE
// question set still fills the minimum rather than handing the interviewer a
// 7-minute plan labelled as a real interview. The per-question minutes flip
// tighter once there are enough questions that the relaxed value would overrun
// the band (6 × 4 + 7 = 31 > 30).
//
// Pure + dependency-free on purpose: it carries no DB/CLI imports so the timing
// contract is unit-testable in isolation (run-of-show.test.ts) and the bounds
// are enforced in CI. interview-prep-run.ts wraps it with the actual generation.

export type PrepQuestion = { competency?: string; question?: string; whatsGoodLooksLike?: string; followUpIfAnswer?: string };
export type ChronologyBlock = { fromMin: number; toMin: number; topic: string; goal: string; questions: string[]; followUp?: string };
export type RunOfShow = {
  scenario: string;
  durationMin: number;
  focusAreas: string[];
  chronology: ChronologyBlock[];
  // The cross-cutting "Signals to confirm" the interviewer ticks off alongside the
  // timed chronology. Always one flat list (the heading is static in the modal), so
  // it's a plain string[] rather than a grouped shape that never had >1 group.
  signals: string[];
};

/** Documented run-of-show duration band (minutes). The computed plan is clamped
 *  to [MIN, MAX] and the chronology is padded to match, so the header duration
 *  and the last block's end time never disagree. */
export const MIN_DURATION_MIN = 15;
export const MAX_DURATION_MIN = 30;

/** Fixed opening block: settle the candidate and frame the session. */
const INTRO_MIN = 3;
/** Fixed closing block: the candidate's questions + next steps. */
const WRAP_MIN = 4;
/** Never plan more than this many question blocks — keeps the plan within MAX and
 *  the interviewer's cognitive load sane; surplus CV questions are dropped. */
const MAX_QUESTIONS = 6;
/** Questions up to this count get the relaxed per-question minutes; beyond it the
 *  tighter value kicks in so the total stays inside the band. */
const RELAXED_QUESTION_LIMIT = 5;
/** Minutes per question: relaxed (more depth each) for a short interview, tighter
 *  once there are many questions to fit within the band. */
const Q_MINUTES_RELAXED = 4;
const Q_MINUTES_TIGHT = 3;
/** Cap on focus areas surfaced in the checklist / scenario. */
const MAX_FOCUS_AREAS = 5;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Build the timed run-of-show + checklist from the CV-derived questions/focus
 *  areas. Pure and deterministic; the duration is guaranteed to land in
 *  [MIN_DURATION_MIN, MAX_DURATION_MIN] and to equal the last block's end. */
export function buildRunOfShow(
  rawQuestions: PrepQuestion[],
  rawFocusAreas: string[],
  candidateLabel: string | null,
  jobTitle: string | null
): RunOfShow {
  const questions = (rawQuestions ?? []).slice(0, MAX_QUESTIONS);
  const focusAreas = (rawFocusAreas ?? []).slice(0, MAX_FOCUS_AREAS);
  const qMinutes = questions.length > RELAXED_QUESTION_LIMIT ? Q_MINUTES_TIGHT : Q_MINUTES_RELAXED;

  const chronology: ChronologyBlock[] = [];
  let cursor = 0;
  const push = (mins: number, topic: string, goal: string, qs: string[], followUp?: string) => {
    chronology.push({ fromMin: cursor, toMin: cursor + mins, topic, goal, questions: qs, followUp });
    cursor += mins;
  };

  push(INTRO_MIN, "Intro & rapport", "Set the candidate at ease, confirm the role context and the plan for the session.", []);
  questions.forEach((q, i) => {
    const topic = q.competency || `Topic ${i + 1}`;
    push(
      qMinutes,
      topic,
      q.whatsGoodLooksLike || "Probe depth and concrete examples; listen for ownership and trade-offs.",
      q.question ? [q.question] : [],
      q.followUpIfAnswer || undefined
    );
  });

  // Sparse-question guard: if intro + questions + wrap would fall below the band's
  // minimum (0 questions → 7 min, 1 question → 11 min), insert an open-discussion
  // block sized to reach MIN so the plan is a real ≥15-min interview, not a stub.
  // The MAX_QUESTIONS cap + the per-question flip keep the upper bound ≤ MAX, so
  // we only ever pad here, never trim.
  const withWrap = cursor + WRAP_MIN;
  const target = clamp(withWrap, MIN_DURATION_MIN, MAX_DURATION_MIN);
  const deficit = target - withWrap;
  if (deficit > 0) {
    push(
      deficit,
      "Open discussion & deep dive",
      "Use the remaining time to probe the strongest and weakest answers in more depth, or explore a must-have not yet covered.",
      []
    );
  }
  push(WRAP_MIN, "Candidate questions & wrap-up", "Leave space for the candidate's questions; explain next steps and timeline.", []);

  // cursor now equals `target` (padding closed any deficit; the cap prevents an
  // overrun), so the clamp is a defensive no-op that keeps the contract explicit.
  const durationMin = clamp(cursor, MIN_DURATION_MIN, MAX_DURATION_MIN);

  // The chronology IS the run-of-show checklist (each block is checkable in the
  // modal), so these are only the cross-cutting signals the interviewer confirms.
  const signals: string[] = [
    ...focusAreas,
    "Probed the depth behind self-declared / project skills",
    "Covered the missing must-haves",
    "Gave the candidate space to ask questions",
  ];

  const scenario =
    `A ${durationMin}-minute structured interview${candidateLabel ? ` for ${candidateLabel}` : ""}${jobTitle ? ` (${jobTitle})` : ""}. ` +
    `Validate strengths and probe ${focusAreas.slice(0, 3).join(", ") || "the key gaps"}. ` +
    "Keep each topic timeboxed and use the checklist to track coverage live.";

  return { scenario, durationMin, focusAreas, chronology, signals };
}
