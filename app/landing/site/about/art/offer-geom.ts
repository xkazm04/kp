/*
 * Pure geometry for OfferArt (step 07), ported from the prototype's
 * about-art/s7-offer.js string builders. Every number is the prototype's; the
 * output strings are byte-identical to what its html() emitted.
 */

/** Gradient / filter id prefix: one Offer drawing per page. */
export const OFFER_ID = "dio-offer-";

/** `url(#dio-offer-<id>)` */
export function offerUrl(id: string): string {
  return `url(#${OFFER_ID}${id})`;
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

/** One gradient stop: [offset, colour class suffix] (the class is `of-s-<suffix>`). */
export type Stop = readonly [number, string];

export type OfferGradient =
  | { kind: "lin"; id: string; x1: number; y1: number; x2: number; y2: number; stops: readonly Stop[] }
  | { kind: "rad"; id: string; cx: number; cy: number; r: number; stops: readonly Stop[] };

/** The hero's gradients, in the prototype's order (the shadow gradient `sh` is written inline). */
export const OFFER_GRADIENTS: readonly OfferGradient[] = [
  { kind: "lin", id: "gw", x1: 0, y1: 0, x2: 1, y2: 1, stops: [[0, "wood-hi"], [0.5, "wood"], [1, "wood-lo"]] },
  { kind: "rad", id: "gk", cx: 0.34, cy: 0.28, r: 0.85, stops: [[0, "wood-hi"], [0.55, "wood"], [1, "wood-lo"]] },
  {
    kind: "lin", id: "gb", x1: 0, y1: 0, x2: 1, y2: 0,
    stops: [[0, "brass-lo"], [0.2, "brass-hi"], [0.5, "brass"], [0.82, "brass-lo"], [1, "brass-dk"]],
  },
  { kind: "lin", id: "gr", x1: 0, y1: 0, x2: 0, y2: 1, stops: [[0, "rub-hi"], [1, "rub"]] },
  { kind: "rad", id: "gf", cx: 0.36, cy: 0.3, r: 0.8, stops: [[0, "red-hi"], [0.6, "red"], [1, "red-lo"]] },
  { kind: "lin", id: "gc", x1: 0, y1: 0, x2: 0, y2: 1, stops: [[0, "case-hi"], [1, "case-lo"]] },
  { kind: "lin", id: "gt", x1: 0.1, y1: 0, x2: 0.9, y2: 1, stops: [[0, "case-hi"], [1, "case"]] },
  { kind: "rad", id: "gd", cx: 0.36, cy: 0.3, r: 0.9, stops: [[0, "red-hi"], [0.55, "red"], [1, "red-lo"]] },
];

/** An ink drop: its body circle and the highlight circle, as the prototype's drop(). */
export type Drop = {
  n: number;
  x: number;
  y: number;
  r: number;
  hx: number;
  hy: number;
  hr: number;
};

function drop(x: number, y: number, r: number, n: number): Drop {
  return { n, x, y, r, hx: r2(x - r * 0.34), hy: r2(y - r * 0.38), hr: r2(r * 0.26) };
}

/** The eight ink drops around the stamp, in the prototype's order. */
export const OFFER_DROPS: readonly Drop[] = [
  drop(112, 99, 6.4, 1),
  drop(121, 124, 3.5, 2),
  drop(100, 80, 2.8, 3),
  drop(11, 104, 3.4, 4),
  drop(20, 86, 2.2, 5),
  drop(119, 64, 2.5, 6),
  drop(6, 130, 2.6, 7),
  drop(104, 126, 2.1, 8),
];

/** The three sparkles: [n, fill class, path]. */
export const OFFER_SPARKS: readonly (readonly [number, string, string])[] = [
  [1, "of-spf-a", sparkPath(18, 50, 8.6)],
  [2, "of-spf-b", sparkPath(30, 22, 5)],
  [3, "of-spf-b", sparkPath(120, 96, 3.8)],
];
