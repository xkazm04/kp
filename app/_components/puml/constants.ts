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
