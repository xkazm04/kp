// Single source of truth for the values the measure -> layout -> render chain
// must keep in lockstep. If measure.ts sized text with a different font than
// PlantUml.tsx renders it, or LINE_H diverged between layout (box heights) and
// render (label tspans), labels would silently overflow their boxes with no
// error. Co-locating them here removes that latent drift hazard.

// Leading for 14px label text — a touch more than the size so multi-line labels
// breathe. layout.ts uses it to size box heights; PlantUml.tsx uses it to
// position the label tspans, so the two MUST match.
export const LINE_H = 18;

// The font-family stack every diagram label uses. measure.ts measures text with
// it (via the NODE/TITLE shorthands below) and PlantUml.tsx renders with it; any
// mismatch mis-sizes every box. 14px floor = the design system's text-sm.
export const FONT_FAMILY = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// Pre-composed CSS `font` shorthands (weight + size + family) for canvas
// measureText, derived from FONT_FAMILY so the weights are the only difference.
export const NODE_FONT = `500 14px ${FONT_FAMILY}`;
export const TITLE_FONT = `600 14px ${FONT_FAMILY}`;

// Outer padding (px) added around the laid-out diagram inside the SVG viewBox.
// Both the inline figure and the expand modal inset their content by it.
export const DIAGRAM_PAD = 8;

// The diagram's three-state status vocabulary — moss = live/automated, coral =
// deliberate human gate, dashed warm stone = remaining gap/to-build. These resolve
// through the design tokens (--color-diagram-* in app/globals.css), NOT through
// literals: this block used to hold six hand-copied hexes, one of which
// (`gate.stroke: #d65a4a`) was byte-identical to --color-coral — the copy naming
// its own origin. The tokens have had dark values since Spark Dark shipped; the
// copies never did, so the diagram painted a near-white gap box onto a #141b24
// canvas in both consumers.
//
// An in-DOM SVG can read CSS variables from a fill/stroke attribute, so it does not
// need the app/_lib/brand.ts JS mirror — that mirror is for the surfaces the token
// system genuinely cannot reach (the edge-runtime OG image, the icons), and using it
// here bought a literal that could not flip.
//
// Still the ONE place these tints live, so the diagram shapes (componentStyle in
// PlantUml.tsx) and the legend swatches (diagrams/page.tsx) can never disagree.
// `dashed` flags the gap state, which renders with a dashed border in both.
export type DiagramStatus = "live" | "gate" | "gap";

export const DIAGRAM_STATUS_TOKENS: Record<
  DiagramStatus,
  { fill: string; stroke: string; dashed?: boolean }
> = {
  live: { fill: "var(--color-diagram-live-fill)", stroke: "var(--color-diagram-live-stroke)" },
  gate: { fill: "var(--color-diagram-gate-fill)", stroke: "var(--color-diagram-gate-stroke)" },
  gap: { fill: "var(--color-diagram-gap-fill)", stroke: "var(--color-diagram-gap-stroke)", dashed: true },
};
