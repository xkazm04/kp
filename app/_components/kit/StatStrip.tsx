"use client";

import type { Figure } from "./types";
import { FigureView } from "./FigureView";
import "./kit.css";

/**
 * @catalog A strip of 2-6 figures in equal columns with dividers: serif numeral, sans unit, quiet "of N", a bar for a drawn share; null prints "—" with its reason.
 */
export function StatStrip({ items }: { items: Figure[] }) {
  return (
    <div className="k-stats" data-part="stat-strip">
      {items.map((f) => <FigureView key={f.label} figure={f} />)}
    </div>
  );
}
