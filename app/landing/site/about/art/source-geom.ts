/*
 * Pure geometry for step 02's drawing (SourceArt.tsx), ported from the
 * prototype's about-art/s2-source.js. Numbers and concatenations are the
 * prototype's, so the `d` strings come out byte-identical.
 */
export { INK, sparkD } from "./design-geom";

/** Pool cards the gates let through: [x, y, rotation] in the funnel's 146x150 frame. */
export const OK_CARDS = [
  [13, 40, -8],
  [31, 49, 10],
  [14, 68, 6],
  [30, 79, -10],
  [15, 96, 10],
  [32, 106, -7],
] as const;

/** Pool cards the gates knock out (drawn hatched and dashed, never deleted). */
export const KO_CARDS = [
  [65, 55, -9],
  [68, 76, 7],
  [64, 97, -5],
  [49, 66, 12],
  [48, 90, -12],
] as const;

/** The avatar tile colour of pool card i. */
export function cardTile(i: number): string {
  return i % 3 === 0 ? "#e6c46a" : i % 3 === 1 ? "#a5d3c8" : "#c9d3dc";
}

/** The comb's seven gate teeth. */
export const TEETH: string[] = Array.from(
  { length: 7 },
  (_, i) => "M97 " + (44 + i * 10) + "H80Q76 " + (47 + i * 10) + " 80 " + (50 + i * 10) + "H97Z"
);

/** Rank numerals drawn as paths (inside drawings numerals are paths, not text). */
export const DIGITS: Record<1 | 2 | 3, string> = {
  1: "M-2.6 -3L0.6 -5.6V5.6",
  2: "M-3.6 -3.4Q-3.2 -6 0 -6Q3.8 -6 3.8 -2.8Q3.8 -0.6 -3.7 5.6H4",
  3: "M-3.6 -5.6H3.4L-0.8 -0.8Q4.2 -1.2 4.2 2.6Q4.2 6.2 -0.3 6.2Q-2.9 6.2 -3.9 4.2",
};

export type Rank = 1 | 2 | 3;

export type RankCardSpec = {
  n: Rank;
  x: number;
  y: number;
  rot: number;
  w: number;
  h: number;
  /** The rosette's two ribbon tails. */
  tails: readonly [string, string];
};

/** The three ranked cards rising out of the sieve, back to front. */
export const RANK_CARDS: readonly RankCardSpec[] = [
  { n: 3, x: 146, y: 56, rot: 12, w: 44, h: 64, tails: ["#cfd6dc", "#a9b3bd"] },
  { n: 2, x: 74, y: 44, rot: -14, w: 46, h: 68, tails: ["#dbe1e6", "#b3bdc6"] },
  { n: 1, x: 113, y: 12, rot: -2, w: 50, h: 74, tails: ["#e6c46a", "#c9a24a"] },
];

/** Path strings of one ranked card, from its half width. */
export function rankCardGeom(n: Rank, w: number) {
  const hw = w / 2;
  return {
    hw,
    tile: n === 1 ? "#e6c46a" : n === 2 ? "#dbe1e6" : "#a5d3c8",
    lines: "M" + (-hw + 6) + " 32H" + (hw - 6) + "M" + (-hw + 6) + " 41H" + (hw - 6) + "M" + (-hw + 6) + " 50H" + (hw - 16),
    glint: "M" + (-hw + 5) + " 4.4H" + (hw - 14),
    ribbon: "translate(" + (n === 2 ? -hw + 3 : hw - 3) + " 6)",
  };
}

/** The sieve bowl's outline. */
export const BOWL = "M50 112Q50 178 112 178Q174 178 174 112Z";
