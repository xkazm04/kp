/**
 * Brand palette — the JS-side mirror of the @theme color tokens in
 * app/globals.css.
 *
 * CSS surfaces never need these: they resolve the same hues through Tailwind
 * utilities (bg-paper, text-ink, …) or raw var(--color-*). This module exists
 * only for the surfaces the CSS token system cannot reach —
 *   - the OG/edge-runtime social card and icons (opengraph-image, apple-icon),
 *     which render to a PNG with no stylesheet, and
 *   - raw SVG fills (the nav icons, ScanAnimation, FactorChart, the
 *     results/shared vignettes) that pass a literal color straight to a fill/
 *     stroke attribute.
 *
 * Keep these literals in lockstep with the @theme block: a rebrand still edits
 * both halves, but the JS copies now live in exactly one place instead of being
 * smeared across ~15 files where the social-card and icon colors could quietly
 * drift from the live UI.
 *
 * "Keep in lockstep" is no longer an honour system: `npm run design:check`
 * (scripts/design/check-design-tokens.mjs) parses globals.css and fails the
 * build if any literal below disagrees with its --color-* token, in either
 * theme. It was written because PAPER had silently drifted to the pre-Option-C
 * cream (#f7f5ef) while the app canvas moved to #fdf8ee — every stylesheet-less
 * light surface was painting a color the UI had stopped using.
 *
 * Constant name -> token is mechanical (`DIAL_STONE` -> `--color-dial-stone`),
 * so a NEW constant is checked automatically; one whose token does not exist
 * fails the gate rather than being skipped.
 */
export const INK = "#17202a";
export const PAPER = "#fdf8ee";
export const MOSS = "#526b4f";
export const CORAL = "#d65a4a";
export const STEEL = "#42606f";
export const LIMEWASH = "#dce7d0";
export const DIAL_STONE = "#8c8779";
export const DIAL_AMBER = "#caa54c";
/** The raised card/panel surface (`bg-white`) in Studio Light. */
export const WHITE = "#ffffff";

/**
 * Studio Light mirror, keyed by ROLE rather than token name — the twin of DARK
 * below, so a component that forks on useTheme() reads the same three keys on
 * both sides instead of pairing named tokens against role names.
 */
export const LIGHT = {
  /** Raised card surface (`white`). */
  SURFACE: WHITE,
  /** Subtle fill (`stone-100`) — chart hover cursors. */
  FILL: "#f1ebdd",
  /** Hairline (`stone-200`) — chart grids, tooltip borders. */
  GRID: "#e6ddcc",
} as const;

/**
 * Spark Dark mirror — the JS copies of the [data-theme="dark"] overrides in
 * globals.css, for the same stylesheet-less surfaces as above. Components
 * pick a side with useTheme() (app/_components/ui/useTheme.ts); see
 * FactorChart for the pattern. Keep in lockstep with the dark block.
 */
export const DARK = {
  INK: "#f4efe3",
  PAPER: "#141b24",
  STEEL: "#9db5c3",
  /** Raised card surface (`bg-white` remap). */
  SURFACE: "#1d2630",
  /** Subtle fill (`stone-100` remap) — chart hover cursors. */
  FILL: "#283442",
  /** Hairline (`stone-200` remap) — chart grids, tooltip borders. */
  GRID: "#364453",
} as const;
