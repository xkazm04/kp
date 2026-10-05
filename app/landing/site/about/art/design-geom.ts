/*
 * Pure path-string math for step 01's drawing (DesignArt.tsx), ported from the
 * prototype's about-art/s1-design.js. Every number and every concatenation is the
 * prototype's, so the `d` strings come out byte-identical.
 */
import type { Side } from "./dio";

export const INK = "#17202a";

export function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Four-point sparkle centred on (x, y) with radius r. */
export function sparkD(x: number, y: number, r: number): string {
  const k = r * 0.28;
  return (
    "M" + x + " " + r2(y - r) + "Q" + r2(x + k) + " " + r2(y - k) + " " + r2(x + r) + " " + y +
    "Q" + r2(x + k) + " " + r2(y + k) + " " + x + " " + r2(y + r) + "Q" + r2(x - k) + " " + r2(y + k) + " " + r2(x - r) + " " + y +
    "Q" + r2(x - k) + " " + r2(y - k) + " " + x + " " + r2(y - r) + "Z"
  );
}

/** Gradient stops as [offset, colour]; the FIRST sits on the lit edge. */
export type Stop = readonly [number, string];
export type Lit = "top" | "bottom";

/** The shared 10.4u x 9.8u frame's three cable rows. */
export const ROWS = [35, 50, 65] as const;

/** The slotted press plate: outer outline + the three slots (even-odd). */
export function plateGeom(): { outer: string; slots: string; rims: string[] } {
  let slots = "";
  const rims: string[] = [];
  for (const y of ROWS) {
    slots += "M55 " + (y - 4.4) + "H67Q70.4 " + (y - 4.4) + " 70.4 " + y + "T67 " + (y + 4.4) + "H55Q51.6 " + (y + 4.4) + " 51.6 " + y + "T55 " + (y - 4.4) + "Z";
    rims.push("M55 " + (y + 4.4) + "H67");
  }
  const outer = "M53 5H67Q76 5 76 14V82Q76 91 67 91H53Q44 91 44 82V14Q44 5 53 5Z";
  return { outer, slots, rims };
}

/** Everything side-dependent about the clay pencil (hero A). */
export function pencilGeom(side: Side) {
  const lit: Lit = side === "r" ? "top" : "bottom";
  const hi = lit === "top" ? -1 : 1; /* +1: the lit band is the local bottom one */
  const L = <T,>(a: T, b: T): T => (lit === "top" ? a : b);
  const H = 15.4;
  const bandLit = "#c6eadf";
  const bandBase = "#86bcb0";
  const bandDark = "#46807a";
  const top = L(bandLit, bandDark);
  const bot = L(bandDark, bandLit);
  const yLit = hi > 0 ? 10.2 : -10.2; /* centre of the lit facet */
  const t = 5.2; /* facet edge */
  /* the paint edge: three arches toward the tip */
  const edge = "Q173 " + -H * 0.66 + " 164 " + -t + "Q173 0 164 " + t + "Q173 " + H * 0.66 + " 164 " + H;
  const bodyOutline = "M52 " + -H + "H164" + edge + "H52Z";
  const woodP = "M164 " + -H + "L192 -5.4V5.4L164 " + H + "Q173 " + H * 0.66 + " 164 " + t + "Q173 0 164 " + -t + "Q173 " + -H * 0.66 + " 164 " + -H + "Z";
  const fh = H + 1;
  return {
    lit,
    bandBase,
    top,
    bot,
    yLit,
    body: {
      outline: bodyOutline,
      top: "M52 " + -H + "H164Q173 " + -H * 0.66 + " 164 " + -t + "H52Z",
      bottom: "M52 " + t + "H164Q173 " + H * 0.66 + " 164 " + H + "H52Z",
      facets: "M52 " + -t + "H164M52 " + t + "H164",
      stripes: "M60 " + -H + "V" + H + "M66 " + -H + "V" + H,
    },
    wood: woodP,
    leadGlint: "M196.5 " + (hi > 0 ? 2 : -2) + "L204 " + (hi > 0 ? 0.6 : -0.6),
    ferrule: {
      outline: "M26 " + -fh + "H52V" + fh + "H26Z",
      grooves: "M33 " + -fh + "V" + fh + "M39 " + -fh + "V" + fh + "M45 " + -fh + "V" + fh,
      glints:
        "M34.7 " + (-fh + 1.6) + "V" + (fh - 1.6) + "M40.7 " + (-fh + 1.6) + "V" + (fh - 1.6) + "M46.7 " + (-fh + 1.6) + "V" + (fh - 1.6),
    },
    eraser: {
      outline: "M14.4 " + (-H + 0.6) + "H27V" + (H - 0.6) + "H14.4A" + (H - 0.6) + " " + (H - 0.6) + " 0 0 1 14.4 " + (-H + 0.6) + "Z",
      glint: "M8.4 " + (hi > 0 ? 5.4 : -5.4) + "Q9.8 " + (hi > 0 ? 9.8 : -9.8) + " 14.6 " + (hi > 0 ? 11.2 : -11.2),
      band: "M18.6 " + (hi > 0 ? 10.4 : -10.4) + "H24.4",
    },
  };
}

/** The brass rule's 21 tick marks (hero B). */
export function ruleTicksD(): string {
  let d = "";
  for (let i = 0; i < 21; i++) {
    const x = 40 + i * 8.4;
    const long = i % 5 === 0;
    d += "M" + r2(x) + " 27.6V" + (long ? 35.4 : 32);
  }
  return d;
}
