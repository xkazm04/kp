/*
 * Chapter 4 — THE ROUTER, as data.
 *
 * The beat table `ArchetypeRouter.tsx` renders from, and the constants
 * chapters.test.ts pins. Pure (imports only the stage ladder), so
 * scenes/beats.test.ts walks every phase against the clock contract.
 *
 * Beats (CYCLE = 14 @ 900ms): 0 outline · 1 signals · 2 the board · 3-6 votes
 * land · 7 the winner · 8 agreement · 9 the declaration rule · 10 the fallback
 * floor · 11-13 hold. STILL = 10.
 */
import { stageOf, type ModuleStage } from "../../stage/stages";

export const CYCLE = 14;
export const STILL = 10;

/** The beats the status line changes on; `about.archetypes.status.s<n>` for each. */
export const STATUS_BEATS = [0, 1, 3, 7, 8, 9, 10] as const;
export type StatusBeat = (typeof STATUS_BEATS)[number];

/** `id` is the archetype's real slug; `key` names its catalog entry. */
export const TARGETS = [
  { id: "student", key: "student" },
  { id: "bau", key: "bau" },
  { id: "career_switcher", key: "switcher" },
] as const;

/** The row that wins the tally drawn below. */
export const WINNER = 0;

/** One rule's vote: which TARGETS row it scores, and by how much. */
export type Vote = readonly [target: number, weight: number];
/** Closed, so `t(`signals.${id}`)` stays a compile-time-checked catalog key —
 *  the same reason ChapterKey is a union rather than `string`. */
export type SignalId = "enrolled" | "yreLow" | "educationDominant" | "substantial";

/**
 * Real `detection.signals[]` entries, each with its real `scores` MAP.
 *
 * `votes` is [index into TARGETS, weight] — a rule may score more than one
 * archetype, and `substantial` does: `{"bau": 1, "career_switcher": 0.5}`. This
 * used to be a single `to`/`w` pair, which dropped that second half: the tally
 * board showed Switcher at a flat 0.0 and the status line divided 4.5 by 5.5.
 * `detect()` cannot produce either number for this signal set — with the same
 * four rules firing it totals 6.0 and returns 0.75 — so a reader who reproduced
 * the example against a real `Routing: …` banner found an agreement they could
 * not reconstruct, and a rule that appears to vote for exactly one archetype.
 * Pinned against archetypes.json by chapters.test.ts.
 */
export const SIGNALS: readonly { id: SignalId; votes: readonly Vote[] }[] = [
  { id: "enrolled", votes: [[0, 2.0]] },
  { id: "yreLow", votes: [[0, 1.5]] },
  { id: "educationDominant", votes: [[0, 1.0]] },
  { id: "substantial", votes: [[1, 1.0], [2, 0.5]] },
];

const weightFor = (votes: readonly Vote[], target: number) => votes.find(([to]) => to === target)?.[1] ?? 0;

/** What each archetype ends the tally on — derived, never hand-kept, so the
 *  board and the division below can't drift from the votes drawn above. */
export const SCORES = TARGETS.map((_, target) => SIGNALS.reduce((n, s) => n + weightFor(s.votes, target), 0));
export const TOTAL = SCORES.reduce((a, b) => a + b, 0);
export const LEADER = Math.max(...SCORES);
// UAT RECON-06 — the winner's SHARE OF THE VOTE, which is why the scene shows the
// division rather than a bare percentage. Named `signalAgreement` everywhere it
// renders now: it is not a confidence, and it is not the measurement interval the
// Matrix calls a score range, nor a model's self-report, nor a salary read's
// evidence grade. Four quantities, four words.
//
// Computed with registry.detect's own formula — `round(scores[best] / total, 2)`
// — rather than typed as a literal, so the number on screen is the number the
// mechanism would return for the votes this scene actually draws.
export const SIGNAL_AGREEMENT = Math.round((LEADER / TOTAL) * 100) / 100;

const votesAt = (i: number) => 3 + i;

/** A target's running tally, counting only the votes that have landed. */
export function tally(voted: readonly boolean[], target: number): number {
  return SIGNALS.reduce((n, s, i) => (voted[i] ? n + weightFor(s.votes, target) : n), 0);
}

export type ArchetypeFrame = {
  signalNames: boolean;
  /** Per SIGNALS row: its card's stage, and whether its vote has landed. */
  signals: readonly ModuleStage[];
  voted: readonly boolean[];
  /** Per TARGETS row. */
  targets: readonly ModuleStage[];
  targetNames: boolean;
  scored: boolean;
  won: boolean;
  agreement: boolean;
  note: ModuleStage;
  declaration: boolean;
  fallback: boolean;
};

export function sceneAt(phase: number): ArchetypeFrame {
  const at = (n: number) => phase >= n;
  return {
    signalNames: at(1),
    signals: SIGNALS.map((_, i) => stageOf({ shell: 1, body: 1, detail: votesAt(i), chosen: null }, phase)),
    voted: SIGNALS.map((_, i) => at(votesAt(i))),
    targets: TARGETS.map((_, i) => stageOf({ shell: 2, body: 2, detail: 3, chosen: i === WINNER ? 7 : null }, phase)),
    targetNames: at(2),
    scored: at(3),
    won: at(7),
    agreement: at(8),
    note: stageOf({ shell: 9, body: 9, detail: 10, chosen: null }, phase),
    declaration: at(9),
    fallback: at(10),
  };
}
