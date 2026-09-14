// The Fit Matrix's cell vocabulary: what a cell IS, and which band class it paints
// with. Pure and JSX-free so `node --test` can load it — MatrixShared.tsx is a .tsx
// and the runner's type-stripping cannot parse JSX, which is why the band mapping
// went untested while it was the single thing every cell in the grid depends on.
// MatrixShared re-exports all three so existing importers are unaffected.
import { MATRIX_BANDS } from "./matrixStats";

// koKeys: stable KoReason.key categories naming WHY a cell is blocked (MAT2);
// present only on blocked cells, localized by key via matrix.ko.* messages.
export type Cell = { score: number | null; blocked: boolean; koKeys?: string[] };

// Blocked/empty cells get a diagonal hatch so they read as "not applicable"
// without relying on the grey fill alone (color-independent legibility).
//
// hatch-through-the-token-seam: the stripe was a raw `#d6d3d1` (stock Tailwind
// stone-300) — the one hardcoded color left outside app/landing/. The ESLint hex gate
// missed it because it anchored on `\b` after the hex and Tailwind spells spaces as
// `_`, a word character, so `#d6d3d1_0px` had no boundary to find. Result: in Spark
// Dark the FILL re-mapped through --color-stone-100 (#f1ebdd -> #283442) while the
// stripe stayed light-theme stone-300 — a pale grey hatch burned across a dark cell.
//
// It now resolves through the token, which Tailwind 4 emits verbatim into the compiled
// arbitrary value (measured: `background-image: repeating-linear-gradient(45deg,
// var(--color-stone-300) 0px,…)`), so the stripe follows [data-theme="dark"] like every
// other surface. Note the LIGHT stripe moves #d6d3d1 -> #d6cbb4: this repo's stone-300
// is the warm Option-C neutral, not Tailwind's cool stock one, so the hatch now sits on
// the same ramp as the stone-100 fill it is drawn over instead of one hue off it.
export const BLOCKED_CELL =
  "bg-stone-100 text-stone-400 [background-image:repeating-linear-gradient(45deg,var(--color-stone-300)_0px,var(--color-stone-300)_1px,transparent_1px,transparent_5px)]";

// diverging score scale: poor -> coral, fair -> amber, good/strong -> moss.
// Bands single-sourced in MATRIX_BANDS (matrix-stats.ts) — pick the highest band
// whose inclusive floor the score clears.
/** The score a cell may ANNOUNCE — `null` when there is none to announce. The same
 *  predicate `cellClass` paints from, exported so the accessible name cannot disagree
 *  with the colour. It did: the grid renders nothing in a null-score cell and paints it
 *  with the unassessed hatch, while `aria-label` said `matchVal { score: c.score ?? 0 }`
 *  and `title` said a bare `c.score ?? 0` — so a screen-reader user was told "match 0"
 *  for a cell the grid itself reads as not assessed, which is exactly the poor fit the
 *  pipeline never computed that the hatch exists to avoid claiming. A GENUINE 0 is a
 *  real score and still announces as 0; only the absent one is silent. */
export function announcedCellScore(c: Cell): number | null {
  return c.blocked || c.score == null ? null : c.score;
}

export function cellClass(c: Cell): string {
  if (c.blocked || c.score == null) return BLOCKED_CELL;
  const s = c.score;
  let cls: string = MATRIX_BANDS[0].cellClass;
  for (const b of MATRIX_BANDS) if (s >= b.min) cls = b.cellClass;
  return cls;
}

