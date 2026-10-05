/*
 * Pure geometry for HiredArt (step 08), ported from the prototype's
 * about-art/s8-hired.js string builders. Every number is the prototype's; the
 * output strings are byte-identical to what its html() emitted.
 */

/** Gradient / filter id prefix: one Hired drawing per page. */
export const HIRED_ID = "dio-hired-";

/** `url(#dio-hired-<id>)` */
export function hiredUrl(id: string): string {
  return `url(#${HIRED_ID}${id})`;
}

/** Round to 2 decimals, as the prototype's r2(). */
export function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** A four-point sparkle centred on (x, y) with radius r: the `d` of the prototype's spark(). */
export function sparkPath(x: number, y: number, r: number): string {
  const k = r * 0.28;
  return (
    `M${x} ${r2(y - r)}Q${r2(x + k)} ${r2(y - k)} ${r2(x + r)} ${y}` +
    `Q${r2(x + k)} ${r2(y + k)} ${x} ${r2(y + r)}Q${r2(x - k)} ${r2(y + k)} ${r2(x - r)} ${y}` +
    `Q${r2(x - k)} ${r2(y - k)} ${x} ${r2(y - r)}Z`
  );
}

type Pt = readonly [number, number];

function mid(p: Pt, q: Pt): Pt {
  return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
}

/** A closed, smooth blob whose radius is a function of the angle (the wax edge). */
export function blobPath(cx: number, cy: number, n: number, fn: (a: number) => number): string {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = fn(a);
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  let m = mid(pts[n - 1], pts[0]);
  let d = `M${r2(m[0])} ${r2(m[1])}`;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    m = mid(p, q);
    d += `Q${r2(p[0])} ${r2(p[1])} ${r2(m[0])} ${r2(m[1])}`;
  }
  return `${d}Z`;
}

/** A five-point star's `points` (outer radius R, inner r), first point straight up. */
export function starPoints(cx: number, cy: number, R: number, r: number): string {
  const s: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = ((-90 + i * 36) * Math.PI) / 180;
    const k = i % 2 ? r : R;
    s.push(`${r2(cx + k * Math.cos(a))},${r2(cy + k * Math.sin(a))}`);
  }
  return s.join(" ");
}

/** The seal's centre. */
export const SEAL = { cx: 64, cy: 66 } as const;

/** The scalloped wax edge. */
export const WAX_PATH = blobPath(
  SEAL.cx,
  SEAL.cy,
  52,
  (a) => 45.5 + 3.4 * Math.sin(11 * a + 0.6) + 1.8 * Math.sin(5 * a + 1.3)
);

/** The check-star inside the seal. */
export const STAR_POINTS = starPoints(SEAL.cx, SEAL.cy + 1, 27, 12.4);

/** One gradient stop: [offset, colour class suffix] (the class is `hd-s-<suffix>`). */
export type Stop = readonly [number, string];

export type HiredGradient =
  | { kind: "lin"; id: string; x1: number; y1: number; x2: number; y2: number; stops: readonly Stop[] }
  | { kind: "rad"; id: string; cx: number; cy: number; r: number; stops: readonly Stop[] };

/** The hero's gradients, in the prototype's order (the shadow gradient `sh` is written inline). */
export const HIRED_GRADIENTS: readonly HiredGradient[] = [
  { kind: "rad", id: "gw", cx: 0.34, cy: 0.28, r: 0.92, stops: [[0, "wax-hi"], [0.5, "wax"], [1, "wax-lo"]] },
  { kind: "rad", id: "gi", cx: 0.4, cy: 0.34, r: 0.8, stops: [[0, "wax"], [1, "wax-lo"]] },
  { kind: "lin", id: "gr", x1: 0, y1: 0, x2: 1, y2: 1, stops: [[0, "rib-hi"], [0.5, "rib"], [1, "rib-lo"]] },
  { kind: "lin", id: "gf", x1: 0, y1: 0, x2: 1, y2: 0, stops: [[0, "box-hi"], [0.5, "box"], [1, "box-lo"]] },
  { kind: "lin", id: "gt", x1: 0, y1: 0, x2: 0, y2: 1, stops: [[0, "box-top-hi"], [1, "box-hi"]] },
  { kind: "lin", id: "gk", x1: 0, y1: 0, x2: 1, y2: 1, stops: [[0, "br-hi"], [0.5, "br"], [1, "br-lo"]] },
  { kind: "lin", id: "gp", x1: 0, y1: 0, x2: 0, y2: 1, stops: [[0, "cream"], [1, "putty"]] },
];

/** The three sparkles: [n, fill class, path]. */
export const HIRED_SPARKS: readonly (readonly [number, string, string])[] = [
  [1, "hd-spf-a", sparkPath(22, 26, 9)],
  [2, "hd-spf-b", sparkPath(178, 46, 6)],
  [3, "hd-spf-b", sparkPath(112, 12, 4.8)],
];

/** The burst's eight ray angles around the stamp. */
export const BURST_ANGLES = ["-160deg", "-120deg", "-70deg", "-20deg", "24deg", "70deg", "118deg", "160deg"] as const;
