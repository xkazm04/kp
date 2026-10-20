import type { CSSProperties, ReactNode } from "react";
import type { ShapeKind, StageTone } from "../types";
import { shapeClass } from "./shapeModel";
import "./graphic.css";

/*
 * How an item reached its state, drawn as a shape (the graphic layer's provenance glyph):
 *   solid  = observed: a recorded row proves it
 *   half   = observed, identity uncertain (matched by name only)
 *   ring   = not observed: generated, or placed without a recorded movement
 *   dashed = nothing on record (the reason travels in the tip)
 *   none   = never reached
 *   exit   = left (rejected)
 * The geometry is the winner's 16-unit viewBox, drawn once here; the Sieve's dots reuse the same radii.
 */
const GEOMETRY: Record<ShapeKind, ReactNode> = {
  solid: <circle cx="8" cy="8" r="5.4" fill="currentColor" />,
  half: (
    <>
      <circle cx="8" cy="8" r="4.8" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 3.2a4.8 4.8 0 0 0 0 9.6z" fill="currentColor" />
    </>
  ),
  ring: <circle cx="8" cy="8" r="4.8" fill="none" stroke="currentColor" strokeWidth="1.8" />,
  dashed: <circle cx="8" cy="8" r="4.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.1 2.1" />,
  none: <path d="M4 8h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />,
  exit: <path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />,
};

/**
 * @catalog A 16px provenance shape (solid walked, half name-only, ring placed, dashed nothing on record, none, exit) in a stage tone.
 *
 * `tip` is the shape's meaning in words: its accessible name (role="img") and the kit's hover tip
 * (`data-tip`, the same tip the everyday Mark carries). The shape itself is not a focus stop: its row
 * is, and the row's reading pane repeats the fact. Pass `tip={null}` only for a
 * decorative repeat whose words already sit beside it (a legend), which hides it from assistive tech.
 */
export function ShapeMark({
  shape,
  tone,
  tip,
  size,
}: {
  shape: ShapeKind;
  tone?: StageTone;
  tip: string | null;
  size?: 14 | 16 | 18;
}) {
  const style = size ? ({ "--shp": `${size}px` } as CSSProperties) : undefined;
  return (
    <span
      className={shapeClass(shape, tone)}
      style={style}
      data-part="shape-mark"
      {...(tip ? { role: "img", "aria-label": tip, "data-tip": tip } : { "aria-hidden": true })}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        {GEOMETRY[shape]}
      </svg>
    </span>
  );
}
