// The workforce surface's places on the kit's level stack (pure; the generic rules are pinned by
// app/_components/kit/scene/levelStack.test.ts, this grammar by workforceNav.test.ts).
//
//   L0 the Clock Wheel · L1 one drawer (a role's cards, or every hire) · L2 the front of a time card
//   · L3 its back (the evidence).
//
// A push opens a level over the current one, a pop returns, popTo is a breadcrumb click, replaceTop is
// a sideways step (the next drawer, the next card). Nothing here knows React, the DOM or the URL.
import { levelReduce, type LevelAction } from "@/app/_components/kit/scene/levelStack.ts";
import type { NextActionKind } from "./agentsWorkforceLogic.ts";
import type { DrawerKey } from "./workforceModel.ts";

/** A drawer level shows one drawer, or "all": the whole rack (reached from a needs queue). */
export type DrawerRef = DrawerKey | "all";

export type WorkforceEntry =
  | { level: 0 }
  /** `need` is a needs kind the drawer opens filtered to (from a queue's "Show it in the rack"). */
  | { level: 1; drawer: DrawerRef; need: NextActionKind | null }
  /** `walk` is the ordered ids the card was opened from, for previous / next. */
  | { level: 2; id: string; walk: readonly string[] }
  | { level: 3; id: string; walk: readonly string[] };

export type WorkforceStack = readonly WorkforceEntry[];
export type WorkforceLevel = WorkforceEntry["level"];

export const WORKFORCE_ROOT: WorkforceStack = [{ level: 0 }];

export type WorkforceAction = LevelAction<WorkforceEntry>;

export function sameEntry(a: WorkforceEntry, b: WorkforceEntry): boolean {
  if (a.level !== b.level) return false;
  if (a.level === 1 && b.level === 1) return a.drawer === b.drawer;
  if ((a.level === 2 && b.level === 2) || (a.level === 3 && b.level === 3)) return a.id === b.id;
  return true;
}

export function workforceReduce(stack: WorkforceStack, action: WorkforceAction): WorkforceStack {
  return levelReduce(stack, action, { root: WORKFORCE_ROOT, same: sameEntry });
}

export function topOf(stack: WorkforceStack): WorkforceEntry {
  return stack[stack.length - 1] ?? WORKFORCE_ROOT[0];
}

export function depthOf(stack: WorkforceStack): number {
  return Math.max(0, stack.length - 1);
}

/** A layer keyed by depth and place: a sideways step remounts, a closing level keeps its instance. */
export function layerKey(entry: WorkforceEntry, depth: number): string {
  if (entry.level === 1) return `${depth}:drawer:${entry.drawer}`;
  if (entry.level === 2 || entry.level === 3) return `${depth}:card:${entry.id}`;
  return `${depth}:wheel`;
}

/** The previous / next id in a walk (wrapping); null when there is nowhere to step. */
export function stepWalk(walk: readonly string[], id: string, delta: 1 | -1): string | null {
  if (walk.length < 2) return null;
  const at = walk.indexOf(id);
  if (at < 0) return walk[0] ?? null;
  return walk[(at + delta + walk.length) % walk.length] ?? null;
}

/** The previous / next drawer key (wrapping); null with fewer than two. */
export function stepDrawer(keys: readonly DrawerKey[], key: DrawerRef, delta: 1 | -1): DrawerKey | null {
  if (keys.length < 2 || key === "all") return null;
  const at = keys.indexOf(key);
  if (at < 0) return null;
  return keys[(at + delta + keys.length) % keys.length] ?? null;
}
