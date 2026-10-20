/*
 * The orbit's geometry, pure (ported from the winner's layoutOrbit / placeCell / fitAxis / callouts).
 * Rings are stages (entry outside, terminal at the centre); given a RingSpec each band's area follows its
 * people (orbitRings.ts, equal density) and the 12 o'clock wedge fits its measured labels. Sectors are groups. A sector's angle grows
 * with people^0.7 plus a floor, so a 984-person family and a 15-person one both read; the most waiting
 * group sits nearest 12 o'clock, alternating right and left so the two callout columns balance. Inside a
 * cell (sector x ring) the people who need a human sit on the outer edge, then the overdue.
 */
import { attentionRank, byUrgency, type Absence, type OrbitGroup, type OrbitPerson } from "./orbitModel.ts";
import { ringBands } from "./orbitRings.ts";

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** The dot's paint kind: waiting on a human, over its stage's SLA, hired, or quietly on time. */
export type DotKind = "w" | "a" | "h" | "q";
export function kindOf(p: Pick<OrbitPerson, "waiting" | "aging" | "terminal">): DotKind {
  return p.waiting ? "w" : p.aging ? "a" : p.terminal ? "h" : "q";
}

export type Dot = { p: OrbitPerson; x: number; y: number; th: number; r: number; k: DotKind; g: string };
export type RimMark = { absence: Absence; x: number; y: number };
export type Sector = { g: OrbitGroup; a0: number; a1: number; mid: number; rim: RimMark[]; rimRows: number };
export type Rings = [number, number][];
export type OrbitGeo = {
  W: number; H: number; R: number; cx: number; cy: number;
  /** Width reserved on each side for the callout columns; 0 = no room, callouts render as a list. */
  side: number;
  rings: Rings;
  wedge: number;
  sectors: Sector[];
  dots: Dot[];
  byId: Map<string, Dot>;
};

export const CALLOUT_W = 272;
const WEIGHT = (g: OrbitGroup) => Math.max(9, Math.pow(g.act, 0.7));

/** The five-ring template for the shipped axis; other axis lengths share the same radial span evenly. */
function ringsFor(count: number, R: number): Rings {
  if (count === 5) return [[0.745, 1.0], [0.523, 0.745], [0.34, 0.523], [0.2, 0.34], [Math.max(0.075, 26 / R), 0.2]];
  const inner = Math.max(0.075, 26 / R);
  const step = (1 - inner) / Math.max(1, count);
  return Array.from({ length: count }, (_, i) => [1 - (i + 1) * step, 1 - i * step] as [number, number]);
}

/** The axis wedge at 12 o'clock carries the ring names; it widens on a small orbit so they never sit on dots. */
function wedgeFor(R: number): number {
  const need = Math.max(70 / (0.4315 * R), 40 / (0.27 * R), 64 / (0.634 * R));
  return Math.min(46 * DEG, Math.max(24 * DEG, need + 4 * DEG));
}

/** The wedge for measured labels (px wide, one per ring, outside in) at their bands' middles: each fits with room. */
export function wedgeForLabels(R: number, rings: Rings, labels: readonly number[]): number {
  let need = 0;
  rings.forEach(([r0, r1], i) => {
    if (i === rings.length - 1) return; // the hub's label sits in the hole, not in the wedge
    need = Math.max(need, ((labels[i] ?? 0) + 10) / (((r0 + r1) / 2) * R));
  });
  return Math.min(46 * DEG, Math.max(12 * DEG, need + 3 * DEG));
}

export function sideFor(W: number): number {
  return W >= 1100 ? 290 : W >= 900 ? 250 : 0;
}

/** How the rings are cut: by the people on each stage (equal density), with the measured width of each ring's label. */
export type RingSpec = { counts: readonly number[]; labels: readonly number[] };

export function layoutOrbit(groups: readonly OrbitGroup[], axisLength: number, W: number, maxH = 900, spec: RingSpec | null = null): OrbitGeo {
  const side = sideFor(W);
  const R = Math.max(150, Math.min((maxH - 76) / 2, (W - 2 * side - 110) / 2));
  const cx = W / 2;
  const cy = R + 34;
  const H = 2 * R + 76;
  const rings = spec && spec.counts.length === axisLength ? ringBands(spec.counts, R) : ringsFor(axisLength, R);
  const wedge = spec ? wedgeForLabels(R, rings, spec.labels) : wedgeFor(R);

  const ranked = [...groups].sort(byUrgency);
  const right: OrbitGroup[] = [];
  const left: OrbitGroup[] = [];
  let rw = 0;
  let lw = 0;
  for (const g of ranked) {
    if (rw <= lw) { right.push(g); rw += WEIGHT(g); } else { left.push(g); lw += WEIGHT(g); }
  }
  const ordered = right.concat(left.reverse());
  const wsum = ordered.reduce((s, g) => s + WEIGHT(g), 0) || 1;
  const span = TAU - wedge;
  const pad = 0.7 * DEG;
  let a = wedge / 2;
  const sectors: Sector[] = [];
  const dots: Dot[] = [];
  for (const g of ordered) {
    const da = (span * WEIGHT(g)) / wsum;
    const s: Sector = { g, a0: a + pad, a1: a + da - pad, mid: a + da / 2, rim: [], rimRows: 0 };
    a += da;
    sectors.push(s);
    for (let si = 0; si < axisLength; si++) {
      const people: OrbitPerson[] = [];
      for (const r of g.roles) for (const p of r.people) if (p.si === si) people.push(p);
      people.sort((x, y) => attentionRank(x) - attentionRank(y));
      placeCell(people, s.a0, s.a1, rings[si][0] * R, rings[si][1] * R, cx, cy, dots, g.key);
    }
    placeRim(s, R, cx, cy);
  }
  return { W, H, R, cx, cy, side, rings, wedge, sectors, dots, byId: new Map(dots.map((d) => [d.p.id, d])) };
}

/** The rim: every empty role in the sector, marked by why it is empty (open first, then drafts). */
function placeRim(s: Sector, R: number, cx: number, cy: number) {
  const empties = s.g.roles.filter((r) => r.act === 0 && r.absence).sort((x, y) => (x.absence === y.absence ? 0 : x.absence === "vacant" ? -1 : 1));
  const ea = s.a1 - s.a0;
  const step = 8;
  const rr = R + 9;
  const perRow = Math.max(1, Math.floor((ea * rr) / step));
  empties.forEach((r, k) => {
    const row = Math.floor(k / perRow);
    const col = k % perRow;
    const rad = rr + row * 8;
    const th = s.a0 + ((col + 0.5) * ea) / perRow;
    s.rim.push({ absence: r.absence as Absence, x: cx + rad * Math.sin(th), y: cy - rad * Math.cos(th) });
  });
  s.rimRows = Math.ceil(empties.length / perRow);
}

/** Pack a cell's people on concentric arcs from the outer edge in, shrinking the pitch until they fit. */
export function placeCell(people: OrbitPerson[], a0: number, a1: number, r0: number, r1: number, cx: number, cy: number, out: Dot[], g: string) {
  const n = people.length;
  if (!n) return;
  const area = ((a1 - a0) / 2) * (r1 * r1 - r0 * r0);
  let s = Math.min(12, Math.max(3, Math.sqrt(area / n) * 0.93));
  for (let attempt = 0; attempt < 12; attempt++) {
    const pos: [number, number, number, number][] = [];
    let r = r1 - s * 0.55;
    let placed = 0;
    while (placed < n && r > r0 + s * 0.25 && r > s * 0.45) {
      const k = Math.max(1, Math.floor(((a1 - a0) * r) / s));
      const m = Math.min(k, n - placed);
      const off = (k - m) / 2;
      for (let j = 0; j < m; j++) {
        const th = a0 + ((a1 - a0) * (j + 0.5 + off)) / k;
        pos.push([cx + r * Math.sin(th), cy - r * Math.cos(th), th, r]);
      }
      placed += m;
      r -= s;
    }
    if (placed >= n) {
      const rad = Math.max(1.4, Math.min(3.3, s * 0.36));
      people.forEach((p, i) => out.push({ p, x: pos[i][0], y: pos[i][1], th: pos[i][2], r: rad, k: kindOf(p), g }));
      return;
    }
    s *= 0.9;
  }
  const rm = (r0 + r1) / 2;
  people.forEach((p, i) => {
    const th = a0 + ((a1 - a0) * (i + 0.5)) / n;
    out.push({ p, x: cx + rm * Math.sin(th), y: cy - rm * Math.cos(th), th, r: 1.4, k: kindOf(p), g });
  });
}

/** Where a sector's leader line leaves the orbit (past its rim marks). */
export function anchorOf(geo: OrbitGeo, s: Sector): { x: number; y: number } {
  const rr = geo.R + 12 + s.rimRows * 8;
  return { x: geo.cx + rr * Math.sin(s.mid), y: geo.cy - rr * Math.cos(s.mid) };
}

export type CalloutPlace = { key: string; right: boolean; left: number; top: number; lineY: number; lineEnd: number; lineTip: number };

/**
 * Stack the callouts in two columns beside the orbit, each as near its sector's anchor height as the
 * ones above and below allow. `heights` are the measured callout heights (px), keyed by group key.
 * Returns the placements and the height the orbit block needs so the last callout is not clipped.
 */
export function placeCallouts(geo: OrbitGeo, heights: ReadonlyMap<string, number>, gap = 4): { places: CalloutPlace[]; height: number } {
  if (!geo.side) return { places: [], height: geo.H };
  const cols: { s: Sector; ay: number; h: number; y: number }[][] = [[], []];
  for (const s of geo.sectors) cols[s.mid < Math.PI ? 0 : 1].push({ s, ay: anchorOf(geo, s).y, h: heights.get(s.g.key) ?? 48, y: 0 });
  let height = geo.H;
  const places: CalloutPlace[] = [];
  cols.forEach((list, side) => {
    const right = side === 0;
    const bx = right ? geo.cx + geo.R + 70 : geo.cx - geo.R - 70 - CALLOUT_W;
    list.sort((a, b) => a.ay - b.ay);
    const n = list.length;
    for (let i = 0; i < n; i++) {
      list[i].y = list[i].ay - list[i].h / 2;
      if (i) list[i].y = Math.max(list[i].y, list[i - 1].y + list[i - 1].h + gap);
      list[i].y = Math.max(list[i].y, 2);
    }
    for (let i = n - 1; i >= 0; i--) {
      const lim = i === n - 1 ? geo.H - 2 - list[i].h : list[i + 1].y - list[i].h - gap;
      if (list[i].y > lim) list[i].y = lim;
    }
    for (let i = 0; i < n; i++) {
      if (list[i].y < 2) list[i].y = 2;
      if (i && list[i].y < list[i - 1].y + list[i - 1].h + gap) list[i].y = list[i - 1].y + list[i - 1].h + gap;
    }
    if (n) height = Math.max(height, list[n - 1].y + list[n - 1].h + 6);
    for (const c of list) {
      places.push({
        key: c.s.g.key, right, left: bx, top: c.y, lineY: c.y + 13,
        lineEnd: right ? bx - 16 : bx + CALLOUT_W + 16, lineTip: right ? bx - 2 : bx + CALLOUT_W + 2,
      });
    }
  });
  return { places, height };
}

/** The sector under a point on the canvas, or null (the axis wedge and the hub answer nothing). */
export function sectorAt(geo: OrbitGeo, px: number, py: number): Sector | null {
  const dx = px - geo.cx;
  const dy = py - geo.cy;
  const d = Math.hypot(dx, dy);
  if (d > geo.R + 40 || d < geo.R * 0.07) return null;
  let th = Math.atan2(dx, -dy);
  if (th < 0) th += TAU;
  return geo.sectors.find((s) => th >= s.a0 - 0.7 * DEG && th <= s.a1 + 0.7 * DEG) ?? null;
}
