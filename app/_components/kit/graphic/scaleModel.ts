/*
 * The graphic layer's answer to scale, pure (no DOM, no React), so node:test reaches it:
 *  - the Sieve's BAR mode: above a caller's threshold one dot per item stops being readable, so a layer
 *    draws its count as a proportional bar and its dot shapes as a legend-sized sample (one shape per
 *    kind present, with how many of that kind), never a dot per item;
 *  - the StageCells bead cap: a cell shows at most `cap` beads, the ones waiting on you first, and says
 *    "+N" for the rest.
 */
import type { ShapeKind, StageTone } from "../types";
import type { SieveItem } from "./sieveLayout";

/** Above this many items the pipeline's Sieve draws bars (about 300 dots is where a field stops reading). */
export const SIEVE_BARS_ABOVE = 300;

/** Whether a Sieve over `count` items draws bars: only when the caller set a threshold and it is exceeded. */
export function drawsBars(count: number, barsAbove: number | undefined): boolean {
  return barsAbove != null && barsAbove >= 0 && count > barsAbove;
}

/** Legend order of the sample: observed first, exits, placed, nothing on record. */
const SAMPLE_ORDER: readonly ShapeKind[] = ["solid", "half", "exit", "ring", "dashed", "none"];

export type SieveBar = {
  count: number;
  /** Items the linked filters keep (count minus the dimmed), drawn as the bar's solid part. */
  kept: number;
  /** 0..1 of the fullest layer: the bar's length. */
  share: number;
  /** How many of those wait on you. */
  needs: number;
  /** One entry per shape kind present, in legend order, with its count. */
  sample: { shape: ShapeKind; n: number; tone?: StageTone }[];
};

/** Per-layer bars: every item counted once, lengths relative to the fullest layer. */
export function sieveBars(layerIds: readonly string[], items: readonly SieveItem[], dim?: ReadonlySet<string>): Record<string, SieveBar> {
  const out: Record<string, SieveBar> = {};
  const kinds: Record<string, Map<ShapeKind, { n: number; tone?: StageTone }>> = {};
  for (const id of layerIds) {
    out[id] = { count: 0, kept: 0, share: 0, needs: 0, sample: [] };
    kinds[id] = new Map();
  }
  for (const it of items) {
    const bar = (out[it.layer] ??= { count: 0, kept: 0, share: 0, needs: 0, sample: [] });
    const k = (kinds[it.layer] ??= new Map());
    bar.count += 1;
    if (!dim?.has(it.id)) bar.kept += 1;
    if (it.needs) bar.needs += 1;
    const cur = k.get(it.shape);
    if (cur) cur.n += 1;
    else k.set(it.shape, { n: 1, tone: it.tone });
  }
  const max = Math.max(1, ...Object.values(out).map((b) => b.count));
  for (const [id, bar] of Object.entries(out)) {
    bar.share = bar.count / max;
    const k = kinds[id];
    bar.sample = SAMPLE_ORDER.filter((s) => k.has(s)).map((shape) => ({ shape, n: k.get(shape)!.n, tone: k.get(shape)!.tone }));
  }
  return out;
}

export type Bead = { id: string; shape: ShapeKind; tone?: StageTone; needs?: boolean };

/** At most `cap` beads, the waiting ones first (then the caller's order), and how many are left over. */
export function capBeads<T extends Bead>(items: readonly T[], cap: number): { beads: T[]; more: number } {
  const n = Math.max(0, Math.floor(cap));
  const ordered = items.some((b) => b.needs) ? [...items.filter((b) => b.needs), ...items.filter((b) => !b.needs)] : items;
  const beads = ordered.slice(0, n);
  return { beads, more: items.length - beads.length };
}
