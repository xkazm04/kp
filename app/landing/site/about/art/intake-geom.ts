/*
 * Pure path math for step 03 (IntakeArt.tsx), ported from the prototype's
 * about-art/s3-intake.js. Every function returns the exact string the prototype
 * built by concatenation, so the drawing's geometry is unchanged. ScreenArt
 * (step 04) reuses `r` and `sparkD`.
 */

/** Round to two decimals, as the prototype's r(). */
export function r(n: number): number {
  return Math.round(n * 100) / 100;
}

export type Pt = [number, number];
export type Cubic = [Pt, Pt, Pt, Pt];

/* ---------- geometry (glass units: the glass is 40.6 x 29.6) ---------- */
/** Door (badge) centres, evenly spread across the top. */
export const MX = [4.9, 12.7, 20.3, 27.9, 35.7];
/** The five slots on the start line, one per door. */
export const SX = [9.3, 14.8, 20.3, 25.8, 31.3];
/** Tube start (under the badge), tube end (nozzle), bezier handle. */
export const Y0 = 5.6;
export const Y1 = 13.8;
export const KK = 3.7;
/** The chequered start line. */
export const BAND_Y = 18.6;
export const BAND_H = 1.6;
const TOK_H = 3.4;
/** A token at rest stands ON the line. */
export const YT = r(BAND_Y - TOK_H / 2);
export const LANE_L = 6.3;
export const LANE_R = 34.3;
export const BAY_Y = 14.1;

export function tubePts(i: number): Cubic {
  return [
    [MX[i], Y0],
    [MX[i], Y0 + KK],
    [SX[i], Y1 - KK],
    [SX[i], Y1],
  ];
}

function bz(p: Cubic, t: number): Pt {
  const a = 1 - t;
  return [
    a * a * a * p[0][0] + 3 * a * a * t * p[1][0] + 3 * a * t * t * p[2][0] + t * t * t * p[3][0],
    a * a * a * p[0][1] + 3 * a * a * t * p[1][1] + 3 * a * t * t * p[2][1] + t * t * t * p[3][1],
  ];
}

function dbz(p: Cubic, t: number): Pt {
  const a = 1 - t;
  return [
    3 * a * a * (p[1][0] - p[0][0]) + 6 * a * t * (p[2][0] - p[1][0]) + 3 * t * t * (p[3][0] - p[2][0]),
    3 * a * a * (p[1][1] - p[0][1]) + 6 * a * t * (p[2][1] - p[1][1]) + 3 * t * t * (p[3][1] - p[2][1]),
  ];
}

export function cubic(p: Cubic): string {
  return (
    "M" + r(p[0][0]) + " " + r(p[0][1]) +
    "C" + r(p[1][0]) + " " + r(p[1][1]) + " " + r(p[2][0]) + " " + r(p[2][1]) + " " + r(p[3][0]) + " " + r(p[3][1])
  );
}

/**
 * A polyline that follows the curve, pushed sideways by `off` (with the travel
 * direction pointing down the page, a positive offset lands on the LEFT of the
 * tube, where the light comes from).
 */
export function offsetLine(p: Cubic, off: number, t0: number, t1: number, n: number): string {
  const out: string[] = [];
  for (let s = 0; s <= n; s++) {
    const t = t0 + ((t1 - t0) * s) / n;
    const q = bz(p, t);
    const d = dbz(p, t);
    const l = Math.sqrt(d[0] * d[0] + d[1] * d[1]) || 1;
    out.push(r(q[0] - (d[1] / l) * off) + " " + r(q[1] + (d[0] / l) * off));
  }
  return "M" + out.join("L");
}

/** A four-point sparkle centred on (x, y), radius s. */
export function sparkD(x: number, y: number, s: number): string {
  const k = s * 0.28;
  return (
    "M" + x + " " + r(y - s) +
    "Q" + r(x + k) + " " + r(y - k) + " " + r(x + s) + " " + y +
    "Q" + r(x + k) + " " + r(y + k) + " " + x + " " + r(y + s) +
    "Q" + r(x - k) + " " + r(y + k) + " " + r(x - s) + " " + y +
    "Q" + r(x - k) + " " + r(y - k) + " " + x + " " + r(y - s) + "Z"
  );
}

/** The path a token rides: down its tube, then onto its slot on the line. */
export function tokenPath(i: number): string {
  return cubic(tubePts(i)) + "L" + r(SX[i]) + " " + YT;
}

/** The seven cross-ties of the track below the line. */
export function tiesD(): string {
  let ties = "";
  for (let i = 0; i < 7; i++) {
    ties += "M" + (LANE_L + 0.3) + " " + r(BAND_Y + BAND_H + 1.05 + i * 1.3) + "H" + (LANE_R - 0.3);
  }
  return ties;
}

/* ---------- HERO: the brass pneumatic-tube manifold (viewBox 332 x 290) ---------- */
const BX = [83, 115, 147, 179, 211];
const BY = 164;
const TIP: Pt[] = [
  [36, 104],
  [80, 58],
  [142, 38],
  [206, 74],
  [262, 116],
];
export const HERO_ANG = [-32, -18, -3, 18, 30];
const HW = 25;

export type HeroTube = {
  tx: number;
  ty: number;
  bx: number;
  ang: number;
  d: string;
  light: string;
  shade: string;
  sheen: string;
  sheen2: string;
  glint: string;
};

/** The five tubes of the hero; `L` is 1 on the left side, -1 when mirrored. */
export function heroTubes(L: number): HeroTube[] {
  const tubes: HeroTube[] = [];
  for (let k = 0; k < 5; k++) {
    const tx = TIP[k][0];
    const ty = TIP[k][1];
    const a = (HERO_ANG[k] * Math.PI) / 180;
    const bx = BX[k];
    const dist = Math.sqrt((tx - bx) * (tx - bx) + (BY - ty) * (BY - ty));
    const p: Cubic = [
      [tx, ty],
      [tx - Math.sin(a) * dist * 0.34, ty + Math.cos(a) * dist * 0.34],
      [bx, BY - dist * 0.38],
      [bx, BY],
    ];
    tubes.push({
      tx,
      ty,
      bx,
      ang: HERO_ANG[k],
      d: cubic(p),
      light: offsetLine(p, HW * 0.22 * L, 0.04, 0.96, 24),
      shade: offsetLine(p, -HW * 0.3 * L, 0.04, 0.96, 24),
      sheen: offsetLine(p, HW * 0.34 * L, 0.08, 0.92, 24),
      sheen2: offsetLine(p, -HW * 0.44 * L, 0.1, 0.9, 24),
      glint: offsetLine(p, HW * 0.34 * L, 0.02, 0.98, 24),
    });
  }
  return tubes;
}
