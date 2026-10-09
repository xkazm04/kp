"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CohortDimension, CohortView } from "../../cohortTypes";
import { LoomCloth } from "./LoomCloth";
import { LoomHead } from "./LoomHead";
import { LoomShuttle } from "./LoomShuttle";
import { LoomWeave } from "./LoomWeave";
import { layoutLoom } from "./loomGeometry";
import type { LoomOrder, RowReading, Thread } from "./loomModel";
import type { Cursor } from "./loomNav";
import type { LoomWords } from "./useLoomWords";

type Row = { dimension: CohortDimension; reading: RowReading; rated: number; note: string | null };

/**
 * Level 0, the loom: the head (the overall claim, the run, how the threads hang), the weave measured
 * to its column (the geometry follows the width and the count, never the data), the shuttle reading
 * what is pointed at, and the cloth (the narrative). Below 760px of world the studio shows its card
 * list instead; the loom still lays out, just narrow.
 */
export function LoomStage({ view, threads, rows, words, order, onOrder, onPull, onOpenReport }: {
  view: CohortView;
  threads: readonly Thread[];
  rows: readonly Row[];
  words: LoomWords;
  order: LoomOrder;
  onOrder: (o: LoomOrder) => void;
  onPull: (d: CohortDimension, memberId: string | null, el: HTMLElement) => void;
  onOpenReport: (slug: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [reading, setReading] = useState<Cursor | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // A covered level is `hidden` (width 0): keep the last width, so the weave (and the knot a pulled
    // row folds back onto) stays mounted under the page instead of being rebuilt on the way back.
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    setWidth(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  const geo = useMemo(() => (width > 0 ? layoutLoom(width, threads.length, rows.length) : null), [width, threads.length, rows.length]);
  const cloth = view.narrative != null;
  return (
    <div className="lm-stage">
      <LoomHead view={view} words={words} order={order} onOrder={onOrder} />
      <div className="lm-body">
        <div ref={box} className="lm-frame">
          {geo ? (
            <LoomWeave
              geo={geo}
              threads={threads}
              rows={rows}
              words={words}
              cloth={cloth}
              reading={reading}
              onRead={setReading}
              onPull={onPull}
              onOpenReport={onOpenReport}
            />
          ) : null}
        </div>
        <LoomShuttle view={view} threads={threads} rows={rows} words={words} reading={reading} />
        <LoomCloth view={view} threads={threads} words={words} onRead={(col) => setReading(col == null ? null : { row: -1, col })} />
      </div>
    </div>
  );
}
