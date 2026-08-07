// Accessibility helpers for the interactive PlantUml renderer, extracted as pure
// functions so they can be unit-tested under the repo's bare `node --test` runner
// (which strips .ts types but can't load .tsx/JSX). See bug-ui-scan-2026-07-09
// (architecture-diagrams #4): clickable diagram nodes were unnamed buttons inside
// a role="img" SVG, so screen-reader users got an unlabeled/opaque control with no
// signal for which step is currently open.

/** ARIA props for a clickable funnel node. Its visible name is the multi-line
 *  `<text>` tspans (e.g. "POST /api/jobs/ingest\njob-ingest.ts"), which AT would
 *  read as disconnected fragments — so we give the node an explicit single-line
 *  accessible name, and expose the coral "active" border as `aria-pressed` so the
 *  currently-open step has a programmatic equivalent, not just a visual one. */
export function clickableNodeAria(label: string, active: boolean): {
  "aria-label": string;
  "aria-pressed": boolean;
} {
  return {
    // Collapse the label's newlines (tspan breaks) into a single spoken string.
    "aria-label": label.replace(/\s*\n\s*/g, " ").trim(),
    "aria-pressed": active,
  };
}

/** The interactive funnel SVG must not be `role="img"` — that collapses its
 *  descendants to one opaque image in many AT, hiding the clickable buttons. When
 *  the SVG carries interactive nodes it is a `group`; otherwise it stays an `img`. */
export function diagramSvgRole(interactive: boolean): "group" | "img" {
  return interactive ? "group" : "img";
}
