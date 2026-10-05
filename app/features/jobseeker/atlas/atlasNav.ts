/*
 * The Atlas's level machine (pure; pinned by atlasNav.test.ts).
 *
 * The surface is a STACK of levels, the root always the sky:
 *   L0 the sky (the hub)  ·  L1 a lens: one of the three setup instruments or the market's lenses
 *   ·  L2 one posting, weighed.
 * The generic half (the reducer's rules, how each layer is on screen) is the kit's level stack
 * (app/_components/kit/scene/levelStack.ts); this module is the Atlas's places. Nothing here
 * knows about React, the DOM or the URL.
 */
import { levelReduce, type LevelAction } from "@/app/_components/kit/scene/levelStack.ts";

/** The lenses a level 1 can open. The first three are setup; the last three are the market's
 *  (the fourth market lens, Weigh, is level 2: it always shows ONE posting). */
export const SETUP_LENSES = ["cv", "read", "want"] as const;
export const MARKET_LENSES = ["sieve", "evening", "sources"] as const;
export type SetupLens = (typeof SETUP_LENSES)[number];
export type MarketLens = (typeof MARKET_LENSES)[number];
export type Lens = SetupLens | MarketLens;

export function isSetupLens(l: Lens): l is SetupLens {
  return (SETUP_LENSES as readonly string[]).includes(l);
}

export type AtlasEntry = { level: 0 } | { level: 1; lens: Lens } | { level: 2; id: string };
export type AtlasStack = readonly AtlasEntry[];

export const ATLAS_ROOT: AtlasStack = [{ level: 0 }];
export type AtlasAction = LevelAction<AtlasEntry>;

export function sameEntry(a: AtlasEntry, b: AtlasEntry): boolean {
  if (a.level !== b.level) return false;
  if (a.level === 1 && b.level === 1) return a.lens === b.lens;
  if (a.level === 2 && b.level === 2) return a.id === b.id;
  return true;
}

export const topOf = (stack: AtlasStack): AtlasEntry => stack[stack.length - 1] ?? ATLAS_ROOT[0]!;
export const depthOf = (stack: AtlasStack): number => Math.max(0, stack.length - 1);

/** One transition by the kit's rules: the root never leaves; pushing a place already on the
 *  stack returns to it; a sideways step keeps its level. */
export function atlasReduce(stack: AtlasStack, action: AtlasAction): AtlasStack {
  return levelReduce(stack, action, { root: ATLAS_ROOT, same: sameEntry });
}

/** A React key per layer: its depth and the place it shows (a sideways step remounts). */
export function layerKey(entry: AtlasEntry, depth: number): string {
  if (entry.level === 1) return `${depth}:l:${entry.lens}`;
  if (entry.level === 2) return `${depth}:w:${entry.id}`;
  return "0";
}

/** The stack a deep link (`?open=<postingId>`) lands on: the posting over the sky. */
export function arrivalStack(openId: string | null): AtlasStack {
  return openId ? [ATLAS_ROOT[0]!, { level: 2, id: openId }] : ATLAS_ROOT;
}
