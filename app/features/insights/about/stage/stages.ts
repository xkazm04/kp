/*
 * The cumulative stage ladder — the shared timeline primitive every About scene
 * is built on.
 *
 * The rule that makes these scenes feel engineered rather than animated: a
 * module is never *shown* or *hidden*, it is at a STAGE, and the stages are
 * cumulative. Every element stays mounted for the whole loop and crossfades
 * between skins, so nothing on the field ever reflows — which means a card
 * solidifying can never move the anchor of a connector drawn to it, and a
 * reader's eye never has to re-find anything.
 *
 * The tick clock decides WHICH stage a module is at (`stageOf`); framer decides
 * the cascade WITHIN that stage (`stepDelay`). Those two jobs never mix: the
 * clock is integer beats you can read as a table, the cascade is sub-beat
 * polish. Keeping them apart is what lets a scene's choreography be reviewed as
 * data in `data.ts` instead of chased through JSX.
 *
 * Pure module: no React, no DOM, no imports. It is the thing scene tests assert
 * against.
 */

/**
 * `ghost`  — the outline is there, holding its space, carrying no content.
 * `shell`  — the surface has solidified; structure is readable, content is not.
 * `body`   — its substance has arrived (the text, the number, the bar).
 * `detail` — the secondary marks land (chips, sub-labels, provenance).
 * `chosen` — the commit beat: this one was picked, scored, approved, sent.
 */
export type ModuleStage = "ghost" | "shell" | "body" | "detail" | "chosen";

const RANK: Record<ModuleStage, number> = { ghost: 0, shell: 1, body: 2, detail: 3, chosen: 4 };

/** "Has this module reached at least `min`?" — the test every dumb part runs. */
export function atStage(stage: ModuleStage, min: ModuleStage): boolean {
  return RANK[stage] >= RANK[min];
}

/**
 * A module's schedule, in ticks. `chosen: null` marks scenery that never gets a
 * commit beat — and that null is often the honest part of a scene: the
 * candidate who is not advanced, the draft that is not sent.
 */
export type StagePlan = {
  shell: number;
  body: number;
  detail: number;
  chosen: number | null;
};

export function stageOf(plan: StagePlan, phase: number): ModuleStage {
  if (plan.chosen !== null && phase >= plan.chosen) return "chosen";
  if (phase >= plan.detail) return "detail";
  if (phase >= plan.body) return "body";
  if (phase >= plan.shell) return "shell";
  return "ghost";
}

/**
 * Sub-beat cascade. One tick is ~900ms, so up to eight parts of a stage can
 * arrive inside their own beat and still read as ONE gesture rather than as a
 * queue. Larger than ~0.12 and the group starts to feel like a list loading.
 */
export const STEP = 0.08;

export function stepDelay(i: number, lead = 0): number {
  return lead + i * STEP;
}

/** Percent-of-field rectangle. See `useSceneClock` for why everything is percent. */
export type Rect = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };

/** Inline style for a percent rect inside a `relative` field. */
export function rectStyle(r: Rect) {
  return { left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` } as const;
}

/** Round to 2dp — keeps generated SVG path strings short and diff-stable. */
export const r2 = (n: number): number => Math.round(n * 100) / 100;
