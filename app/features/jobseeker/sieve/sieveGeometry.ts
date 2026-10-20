// The sieve's drawing, as numbers — pure, so `node --test` can hold it (sieveGeometry.test.ts).
//
// Layers are stacked top-down: the door (held postings), one layer per hard gate (most-
// catching first; a posting failing two gates is drawn on the first, ghosted on the
// second), then "waiting for a score"; below them the scored field, piled into 2-point
// bins along the score axis. A layer's band grows with its dots and stops at
// MAX_LAYER_ROWS rows, past which a "+N" tail counts the rest.

import { firstGate, type SieveFacts, type SievePosting } from "./sieveModel";
import { cx } from "./sieveRecipes";

const LAYER_GAP = 116;
const FIRST_Y = 172;
const FIELD_LBL = 96;

export type Layer = {
  kind: "door" | "gate" | "wait";
  key: string;
  items: SievePosting[];
  also: SievePosting[];
  all: SievePosting[];
  /** The layer's line (dots sit on it). */
  y: number;
  /** Where the layer's label starts: just under the layer above. */
  top: number;
  /** Postings past MAX_LAYER_ROWS rows, drawn as a "+N" tail. */
  overflow: number;
};
export type Dot = { id: string; layer: string; x: number; y: number; r: number; cls: string };
export type Model = { layers: Layer[]; dots: Dot[]; ghosts: { x: number; y: number; r: number }[]; fieldTop: number; base: number; H: number; x0: number; pitch: number; fx(v: number): number };

export function asIf(row: SievePosting): number {
  return row.asIfTotal ?? 0;
}

/** At most this many rows of dots per layer; the rest is a "+N" tail, so 600 held
 *  postings at phone width stay one readable band instead of a tower. */
export const MAX_LAYER_ROWS = 10;

export function sieveGeometry(facts: SieveFacts, W: number): Model {
  const x0 = Math.max(W * 0.42, 250);
  const x1 = W - 18;
  const pitch = Math.max(11, Math.min(16, (x1 - x0) / 34));
  const rr = pitch * 0.38;
  const cols = Math.max(6, Math.floor((x1 - x0) / pitch));
  const specs: Omit<Layer, "y" | "top" | "overflow">[] = [];
  if (facts.held.length) specs.push({ kind: "door", key: "door", items: facts.held, also: [], all: facts.held });
  for (const key of facts.gateKeys) {
    const all = facts.gated.filter((r) => r.blockedBy.includes(key));
    specs.push({ kind: "gate", key, items: all.filter((r) => firstGate(r, facts.gateKeys) === key), also: all.filter((r) => firstGate(r, facts.gateKeys) !== key), all });
  }
  if (facts.waiting.length) specs.push({ kind: "wait", key: "wait", items: facts.waiting, also: [], all: facts.waiting });

  // Each band is as tall as its dots need (never less than the winner's 116px), so a
  // layer's rows never climb into the layer above it or off the top of the stage.
  const layers: Layer[] = [];
  let prev = FIRST_Y - LAYER_GAP;
  for (const spec of specs) {
    const slots = Math.min(spec.items.length + spec.also.length, cols * MAX_LAYER_ROWS);
    const rows = Math.max(1, Math.ceil(slots / cols));
    const y = Math.max(prev + LAYER_GAP, prev + rows * pitch + 30);
    layers.push({ ...spec, y, top: prev + 16, overflow: Math.max(0, spec.items.length + spec.also.length - cols * MAX_LAYER_ROWS) });
    prev = y;
  }
  const y = prev + LAYER_GAP;
  const dots: Dot[] = [];
  const ghosts: { x: number; y: number; r: number }[] = [];
  const at = (i: number, ly: number) => ({ x: x0 + (i % cols) * pitch + pitch / 2, y: ly - rr - 5 - Math.floor(i / cols) * pitch });
  for (const L of layers) {
    const room = cols * MAX_LAYER_ROWS;
    const list = [...L.items].sort((a, b) => (L.kind === "door" ? (a.sourceId < b.sourceId ? -1 : 1) : asIf(b) - asIf(a)));
    list.slice(0, room).forEach((row, i) => {
      const p = at(i, L.y);
      const cls = L.kind === "door" ? "d-held" : L.kind === "wait" ? "d-wait" : cx("d-gated", row.blockedBy.length > 1 && "d-double");
      dots.push({ id: row.id, layer: L.key, x: p.x, y: p.y, r: rr, cls });
    });
    L.also.slice(0, Math.max(0, room - list.length)).forEach((_, j) => {
      const p = at(list.length + j, L.y);
      ghosts.push({ x: p.x, y: p.y, r: rr * 0.85 });
    });
  }
  const top = new Map(facts.top5.map((r, i) => [r.id, i + 1]));
  const fx = (v: number) => 24 + (v / 100) * (W - 48);
  const binW = (W - 48) / 50;
  const colsPer = binW >= 30 ? 3 : binW >= 16 ? 2 : 1;
  const fr = Math.max(3.4, Math.min(5, binW / (colsPer * 2.3)));
  const rowP = fr * 2 + 1.4;
  const bins = new Map<number, number>();
  let maxRows = 0;
  for (const row of facts.scored) {
    const b = Math.min(49, Math.floor((row.matchTotal ?? 0) / 2));
    const n = (bins.get(b) ?? 0) + 1;
    bins.set(b, n);
    maxRows = Math.max(maxRows, Math.ceil(n / colsPer));
  }
  const fieldTop = (layers.length ? y - LAYER_GAP : FIRST_Y - 40) + 28;
  // (`y` is the line one gap below the last layer; the field starts just under it.)
  const fieldH = FIELD_LBL + Math.max(40, maxRows * rowP + 14);
  const base = fieldTop + fieldH;
  const fill = new Map<number, number>();
  for (const row of facts.scored) {
    const b = Math.min(49, Math.floor((row.matchTotal ?? 0) / 2));
    const k = fill.get(b) ?? 0;
    fill.set(b, k + 1);
    const cx0 = fx(b * 2 + 1) + ((k % colsPer) - (colsPer - 1) / 2) * rowP;
    const cy0 = base - fr - 2 - Math.floor(k / colsPer) * rowP;
    dots.push({
      id: row.id,
      layer: "field",
      x: cx0,
      y: cy0,
      r: top.has(row.id) ? fr + 1.6 : fr,
      cls: cx(`d-${row.fitTier ?? "partial"}`, top.has(row.id) && "d-top", row.status === "gone" && "d-gone"),
    });
  }
  return { layers, dots, ghosts, fieldTop, base, H: base + 46, x0, fx, pitch };
}
