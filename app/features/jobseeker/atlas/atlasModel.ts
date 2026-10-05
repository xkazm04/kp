// The Sky Atlas's pure half: which gate the seeker stands at, and where every posting is
// drawn. No React, no fetch, no DOM - `node --test` pins it (atlasModel.test.ts).
//
// Ported from the contest winner me-hub A/3 "The Sky Atlas" (2026-09-30), whose placement
// rules are kept: radius = 100 minus the score, the angle is a sector, the place inside
// the sector comes from the posting's id (so a mark never moves between visits), and what
// never reached a score lives on the RIM - never plotted at 0.
//
// Two departures from the prototype, both forced by the real data:
//  - SECTORS are the SOURCES, not the role family. The summary rows carry no role family
//    (only the structured job does, and on the operator's own DB 242 of 247 postings had
//    none), while every row names its source. "Where it came from" is also what a seeker
//    can act on (Sources is a lens).
//  - The GATE needs the five wants that steer the search, not six. Languages are the sixth
//    card, shown and editable, but they do not change the ranking (docs/features/jobseeker
//    README, step 4), so they never hold the market shut.

import type { JobseekerPreferences, KoReasonKey } from "@/app/_lib/jobseeker/types";
import { firstGate, type SieveFacts, type SievePosting } from "../sieve/sieveModel";

/* ------------------------------------------------------------------ the gate */

/** The six cards of "What you want", in the order the deck lists them. */
export const WANT_KEYS = ["places", "pay", "titles", "modes", "level", "languages"] as const;
export type WantKey = (typeof WANT_KEYS)[number];
/** The five that steer the search: the dome opens when all of them are set. */
export const REQUIRED_WANTS: readonly WantKey[] = ["places", "pay", "titles", "modes", "level"];

/** Which cards hold a value. A floor without a currency is not stored, so it is not set. */
export function wantsSet(prefs: JobseekerPreferences | null): Record<WantKey, boolean> {
  return {
    places: !!prefs && prefs.locations.length + prefs.countries.length > 0,
    pay: !!prefs && !!prefs.salaryFloor && prefs.salaryFloor.amount > 0 && !!prefs.salaryFloor.currency,
    titles: !!prefs && prefs.targetTitles.length > 0,
    modes: !!prefs && prefs.workModes.length > 0,
    level: !!prefs && !!prefs.seniority,
    languages: !!prefs && (prefs.languages ?? []).length > 0,
  };
}

export type Gate = "no-cv" | "cv-in" | "ready";
export type Lock = { gate: Gate; n: number; total: number; missing: WantKey[] };

/** What stands between the seeker and the market: no CV, a CV with wants still missing, or
 *  nothing (ready). `n` counts only the required wants. */
export function lockOf(hasCv: boolean, set: Record<WantKey, boolean>): Lock {
  const missing = REQUIRED_WANTS.filter((k) => !set[k]);
  const n = REQUIRED_WANTS.length - missing.length;
  const gate: Gate = !hasCv ? "no-cv" : missing.length === 0 ? "ready" : "cv-in";
  return { gate, n, total: REQUIRED_WANTS.length, missing };
}

/* ------------------------------------------------------------------ the sky's geometry */

export const SK = { VB: 1000, C: 500, RH: 400, RHOLE: 184, RIM: 437, LBL: 474, NAME: 381 } as const;
/** A score's radius: 100 sits near the zenith plate, 0 near the horizon. */
export const rOf = (score: number): number => SK.RH * (0.46 + (0.5 * (100 - score)) / 100);
export const polar = (r: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [SK.C + r * Math.cos(a), SK.C + r * Math.sin(a)];
};
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const f1 = (n: number): number => +n.toFixed(1);

/** FNV-1a over `${salt}:${id}`, folded to [0, 1): the same id always lands in the same place. */
export function hash01(id: string, salt: string): number {
  let h = 2166136261;
  const s = `${salt}:${id}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export type Sector = { key: string; count: number; start: number; end: number; span: number; mid: number };

/** One sector per source, widest first, each at least 18 degrees; the first sits at 3 o'clock.
 *  The spans always add up to 360. */
export function sectorsFor(rows: readonly Pick<SievePosting, "sourceId">[]): Sector[] {
  const count = new Map<string, number>();
  for (const r of rows) count.set(r.sourceId, (count.get(r.sourceId) ?? 0) + 1);
  const keys = [...count.keys()].sort((a, b) => (count.get(b)! - count.get(a)!) || (a < b ? -1 : 1));
  if (keys.length === 0) return [];
  const total = rows.length;
  const floor = Math.min(18, 360 / keys.length);
  const free = 360 - floor * keys.length;
  const out: Sector[] = [];
  let a = 0;
  const spans = keys.map((k) => floor + (free * count.get(k)!) / total);
  a = -spans[0]! / 2;
  keys.forEach((k, i) => {
    out.push({ key: k, count: count.get(k)!, start: a, end: a + spans[i]!, span: spans[i]!, mid: a + spans[i]! / 2 });
    a += spans[i]!;
  });
  return out;
}

type Pt = { id: string; rad: number; ang: number };

/** Push neighbours apart along the sector's arc until the stars no longer sit on each other.
 *  A crowded sector loosens its minimum so the pass stays cheap and inside its bounds. */
function relaxSector(pts: Pt[], s: Sector): void {
  const MIN = pts.length > 60 ? 5.5 : pts.length > 30 ? 9 : 13;
  const pad = 2.6;
  for (let it = 0; it < 90; it++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i]!;
        const b = pts[j]!;
        const rm = (a.rad + b.rad) / 2;
        const dr = a.rad - b.rad;
        const need = Math.sqrt(Math.max(0, MIN * MIN - dr * dr)) / rm;
        const da = ((b.ang - a.ang) * Math.PI) / 180;
        if (Math.abs(da) < need) {
          const push = (((need - Math.abs(da)) / 2) * 180) / Math.PI;
          const sg = da === 0 ? 1 : Math.sign(da);
          a.ang -= sg * push;
          b.ang += sg * push;
          moved = true;
        }
      }
    }
    for (const p of pts) p.ang = clamp(p.ang, s.start + pad, s.end - pad);
    if (!moved) break;
  }
}

export type Mark = { id: string; sector: string; scatter: [number, number]; star: [number, number] | null };
export type SkyLayout = { sectors: Sector[]; marks: Record<string, Mark> };

/** Every posting's two places: the unlit scatter (before the dome opens) and, for a scored
 *  row, its star - radius from its score. `scored` are the rows the sieve scored. */
export function skyLayout(rows: readonly SievePosting[], scored: readonly SievePosting[]): SkyLayout {
  const sectors = sectorsFor(rows);
  const byKey = new Map(sectors.map((s) => [s.key, s]));
  const pad = 2.6;
  const marks: Record<string, Mark> = {};
  for (const r of rows) {
    const s = byKey.get(r.sourceId)!;
    const ang = s.start + pad + (s.span - 2 * pad) * hash01(r.id, "a");
    const rad = SK.RH * (0.52 + 0.33 * hash01(r.id, "r"));
    marks[r.id] = { id: r.id, sector: s.key, scatter: polar(rad, ang), star: null };
  }
  const bySector = new Map<string, Pt[]>();
  for (const r of scored) {
    if (r.matchTotal === null) continue;
    const s = byKey.get(r.sourceId);
    if (!s) continue;
    const list = bySector.get(s.key) ?? [];
    list.push({ id: r.id, rad: rOf(r.matchTotal), ang: s.start + pad + (s.span - 2 * pad) * hash01(r.id, "a") });
    bySector.set(s.key, list);
  }
  for (const [key, pts] of bySector) {
    pts.sort((a, b) => a.ang - b.ang || (a.id < b.id ? -1 : 1));
    relaxSector(pts, byKey.get(key)!);
    for (const p of pts) {
      const m = marks[p.id];
      if (m) m.star = polar(p.rad, p.ang);
    }
  }
  return { sectors, marks };
}

/* ------------------------------------------------------------------ the rim */

export type RimGroup = {
  kind: "gate" | "held" | "wait";
  key: KoReasonKey | "held" | "wait";
  rows: SievePosting[];
  /** How many postings the gate caught in all (a row failing two gates is drawn once). */
  total: number;
  start: number;
  end: number;
  mid: number;
};
export type RimLayout = { groups: RimGroup[]; pos: Record<string, [number, number]> };

/** The rim: the gates as labelled arcs, then held at the door, then waiting for a score.
 *  The step between marks shrinks when the rim is crowded so every mark stays on the circle. */
export function rimLayout(facts: Pick<SieveFacts, "gated" | "held" | "waiting" | "gateKeys" | "gateCounts">): RimLayout {
  const byGate = new Map<KoReasonKey, SievePosting[]>();
  for (const r of facts.gated) {
    const k = firstGate(r, facts.gateKeys);
    if (!k) continue;
    byGate.set(k, [...(byGate.get(k) ?? []), r]);
  }
  const sortRows = (rows: SievePosting[]) => rows.sort((x, y) => (x.sourceId < y.sourceId ? -1 : x.sourceId > y.sourceId ? 1 : x.id < y.id ? -1 : 1));
  const groups: Omit<RimGroup, "start" | "end" | "mid">[] = [];
  for (const k of facts.gateKeys) {
    const rows = byGate.get(k);
    if (rows) groups.push({ kind: "gate", key: k, rows: sortRows([...rows]), total: facts.gateCounts[k] ?? rows.length });
  }
  groups.push({ kind: "held", key: "held", rows: sortRows([...facts.held]), total: facts.held.length });
  groups.push({ kind: "wait", key: "wait", rows: sortRows([...facts.waiting]), total: facts.waiting.length });
  const marksN = groups.reduce((n, g) => n + g.rows.length, 0);
  const gap = 4;
  const room = 360 - groups.length * gap - groups.length * 20;
  const step = Math.min(((16 / SK.RIM) * 180) / Math.PI, Math.max(0.35, room / Math.max(1, marksN)));
  let ang = 98;
  const pos: Record<string, [number, number]> = {};
  const out: RimGroup[] = [];
  for (const g of groups) {
    const n = g.rows.length;
    const span = Math.max(n * step + 1, g.kind === "gate" ? 22 : 20);
    const off = (span - n * step) / 2;
    g.rows.forEach((r, i) => {
      pos[r.id] = polar(SK.RIM, ang + off + step * (i + 0.5));
    });
    out.push({ ...g, start: ang, end: ang + span, mid: ang + span / 2 });
    ang += span + gap;
  }
  return { groups: out, pos };
}

/** An arc of a circle as an SVG path. */
export function arcPath(r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(r, a0);
  const [x1, y1] = polar(r, a1);
  return `M${f1(x0)} ${f1(y0)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${f1(x1)} ${f1(y1)}`;
}

/** A label set along a radius reads upright: flip it when it would be upside down. */
export function rotFor(deg: number): number {
  let r = deg + 90;
  r = ((((r + 180) % 360) + 360) % 360) - 180;
  if (Math.abs(r) > 90) r -= 180 * Math.sign(r);
  return r;
}

/** The aperture of the dome's iris: shut with no CV, opening with each required want, gone when ready. */
export function aperture(lock: Lock): number {
  if (lock.gate === "ready") return SK.RH * 1.1;
  if (lock.gate === "no-cv") return 0;
  return SK.RH * (0.04 + (0.98 * lock.n) / lock.total);
}

/** The tone (and halo width) a star is drawn with: confidence band wide = big halo. */
export function bandWidth(row: Pick<SievePosting, "confidence">): number {
  return row.confidence ? row.confidence.high - row.confidence.low : 20;
}
