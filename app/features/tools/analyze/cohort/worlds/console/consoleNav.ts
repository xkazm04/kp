/*
 * The Console world's level machine, desk keyboard and solo geometry (pure; pinned by
 * consoleNav.test.ts). Nothing here knows React or the DOM.
 *
 * Levels: L0 the desk; L1 one bus SOLOED ({ dimension, focus }: the member the descent started
 * from, or null when the bus's own SOLO key was pressed). The generic stack rules are the kit's
 * levelStack; a sideways step walks the buses in desk order and wraps.
 *
 * The desk's roving focus is a grid: row 0 is the scribble strips (one per channel), rows 1..7 are
 * the buses in BUS_ORDER; column -1 is a bus's head (its SOLO key; the scribble row has none),
 * columns 0..n-1 the channels in patch order.
 *
 * The solo transition: the pressed bus's band (its top and bottom in the layer's box) opens to the
 * whole layer as `clip-path: inset()`, and closes back onto the same band.
 */
import { levelReduce, type LevelAction } from "@/app/_components/kit/scene/levelStack.ts";
import type { CohortDimension } from "../../cohortTypes.ts";
import { BUS_ORDER } from "./consoleModel.ts";

export type ConsoleEntry = { level: 0 } | { level: 1; dimension: CohortDimension; focus: string | null };
export type ConsoleStack = readonly ConsoleEntry[];
export const CONSOLE_ROOT: ConsoleStack = [{ level: 0 }];

export const sameEntry = (a: ConsoleEntry, b: ConsoleEntry): boolean =>
  a.level === b.level && (a.level === 0 || (b.level === 1 && a.dimension === b.dimension));

export function consoleReduce(stack: ConsoleStack, action: LevelAction<ConsoleEntry>): ConsoleStack {
  return levelReduce(stack, action, { root: CONSOLE_ROOT, same: sameEntry });
}

export const topOf = (stack: ConsoleStack): ConsoleEntry => stack[stack.length - 1] ?? CONSOLE_ROOT[0];

/** A layer's React key: depth + bus, so a sideways step remounts and a closing level keeps its instance. */
export const layerKey = (e: ConsoleEntry, depth: number): string => (e.level === 0 ? "desk" : `solo-${depth}-${e.dimension}`);

/** The next bus in desk order (wrapping). A dimension the desk does not draw stays put. */
export function stepBus(dim: CohortDimension, delta: 1 | -1): CohortDimension {
  const order = BUS_ORDER as readonly CohortDimension[];
  const at = order.indexOf(dim);
  if (at < 0) return dim;
  return order[(at + delta + order.length) % order.length];
}

/* ------------------------------------------------------------------ the desk's roving focus */

export type DeskPos = { row: number; col: number };
export const DESK_ROWS = BUS_ORDER.length + 1;

/** The bus a desk row carries (row 0 is the scribble strips: null). */
export const busAtRow = (row: number): CohortDimension | null => (row >= 1 && row <= BUS_ORDER.length ? BUS_ORDER[row - 1] : null);
export const rowOfBus = (dim: CohortDimension): number => (BUS_ORDER as readonly CohortDimension[]).indexOf(dim) + 1;

/** The position a key moves to from `pos` over `cols` channels, or null when the key is not the desk's. */
export function moveDesk(pos: DeskPos, key: string, cols: number): DeskPos | null {
  const minCol = (row: number) => (row >= 1 ? -1 : 0);
  const fit = (row: number, col: number): DeskPos => ({ row, col: Math.max(minCol(row), Math.min(cols - 1, col)) });
  switch (key) {
    case "ArrowLeft":
      return fit(pos.row, pos.col - 1);
    case "ArrowRight":
      return fit(pos.row, pos.col + 1);
    case "ArrowUp":
      return fit(Math.max(0, pos.row - 1), pos.col);
    case "ArrowDown":
      return fit(Math.min(DESK_ROWS - 1, pos.row + 1), pos.col);
    case "Home":
      return fit(pos.row, minCol(pos.row));
    case "End":
      return fit(pos.row, cols - 1);
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ the solo geometry */

type RectLike = { top: number; height: number };
/** The open and close durations of a solo (the mute runs first, inside the open's delay). */
export const SOLO_OPEN = { ms: 620, delay: 160, easing: "cubic-bezier(.2,.8,.2,1)" } as const;
export const SOLO_CLOSE = { ms: 460, easing: "cubic-bezier(.6,0,.4,1)" } as const;
export const SOLO_FADE_MS = 140;
export const SOLO_SWAP_MS = 200;

/**
 * The band the solo opens from, in the layer's own box: the pressed bus's top and its distance
 * from the layer's bottom. With no visible bus (it scrolled away, or none was pressed) the band is
 * a thin line a third of the way down the box, so the level still opens from somewhere.
 */
export function busBand(box: RectLike, bus: RectLike | null): { top: number; bottom: number } {
  if (!bus || bus.height <= 0) {
    const mid = Math.round(Math.min(box.height / 3, 240));
    return { top: mid, bottom: Math.max(0, box.height - mid - 2) };
  }
  const top = Math.max(0, Math.round(bus.top - box.top));
  const bottom = Math.max(0, Math.round(box.top + box.height - (bus.top + bus.height)));
  return { top, bottom };
}

/** The two clip-path keyframes of a solo, in order: the band to the whole box (open), or back. */
export function soloFrames(band: { top: number; bottom: number }, dir: "open" | "close"): [string, string] {
  const narrow = `inset(${band.top}px 0px ${band.bottom}px 0px round 12px)`;
  const whole = "inset(0px 0px 0px 0px round 0px)";
  return dir === "open" ? [narrow, whole] : [whole, narrow];
}
