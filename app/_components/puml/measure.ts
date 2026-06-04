// Text measurement used to size diagram nodes before ELK lays them out. Uses a
// shared canvas 2d context in the browser; falls back to a per-character
// estimate when no DOM is available (SSR / tests) so sizing stays deterministic.

import { NODE_FONT } from "./constants";

let cachedCtx: CanvasRenderingContext2D | null | undefined;

function ctx(): CanvasRenderingContext2D | null {
  if (cachedCtx !== undefined) return cachedCtx;
  if (typeof document === "undefined") {
    cachedCtx = null;
    return null;
  }
  cachedCtx = document.createElement("canvas").getContext("2d");
  return cachedCtx;
}

export function measure(text: string, font = NODE_FONT): number {
  const c = ctx();
  if (!c) return text.length * 6.7; // heuristic fallback
  c.font = font;
  return c.measureText(text).width;
}

/** Width of the widest line in a (possibly multi-line) label. */
export function measureLines(lines: string[], font = NODE_FONT): number {
  return lines.reduce((max, line) => Math.max(max, measure(line, font)), 0);
}
