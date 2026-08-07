"use client";

// One labelled facet row inside the board header (PipelineFilterBar).
//
// Was the whole facet BLOCK — score chips, source chips and a sort <Select> crammed
// onto one wrapping line, with only the two inline "SCORE"/"SOURCE" captions to say
// which chip belonged to which dimension. At three or more sources the line wrapped
// and the captions stopped aligning with anything. It is now a layout primitive: a
// fixed label gutter and a chip well, so State / Score / Source / Sort stack as
// scannable rows whose labels line up in a column.

import type { ReactNode } from "react";

/** Grid the rows must be rendered into: an auto label column + the chip well.
 *  `auto` is what makes the gutter self-size to the WIDEST label present, so the
 *  chips line up in every locale — a hardcoded gutter that fits "STATE/SCORE/SORT"
 *  in English is already too narrow for "SORTIEREN" in German. */
export const FACET_GRID = "grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5";

/** One labelled facet row. Renders as a FRAGMENT — two cells of the parent
 *  FACET_GRID — so every row shares one label column rather than each row
 *  measuring its own. */
export function PipelineFacetRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="pt-0.5 text-meta uppercase tracking-wide text-steel">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">{children}</div>
    </>
  );
}
