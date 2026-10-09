"use client";

import { useMemo, useRef, useState, type ReactElement } from "react";
import { layerModeAt, type LayerMode } from "@/app/_components/kit/scene";
import { usePersistedChoice } from "@/app/features/hiring/pipeline/orbit/usePersistedChoice";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import type { CohortDimension, CohortWorldProps } from "../../cohortTypes";
import { LoomLevel } from "./LoomLevel";
import { LoomRail } from "./LoomRail";
import { LoomStage } from "./LoomStage";
import { isLoomOrder, rowsOf, threadsOf } from "./loomModel";
import { layerKey, stepDimension, type LoomEntry, type LoomStack } from "./loomNav";
import { useLoomKeys } from "./useLoomKeys";
import { useLoomNav } from "./useLoomNav";
import { useLoomPull } from "./useLoomPull";
import { useLoomWords } from "./useLoomWords";
import "./loom.css";

/**
 * The Loom (spark analyze-v2-cohort, WP6). Candidates hang as vertical warp threads, the seven
 * dimensions cross them as weft rows, every crossing is a knot whose size and dye carry the tier and
 * whose numeral is the rating. Absent cells are no knot (the thread passes behind, with its reason),
 * a decoy hangs slack, a lead that clears is bound with a selvedge, a top inside the noise is joined
 * by a loose float. Pressing a row, or a knot on it, PULLS THAT THREAD OUT: the row lifts from the
 * weave and unravels into its DimensionPage (useLoomPull); Esc winds it back. README-less on purpose:
 * loomModel / loomGeometry / loomNav / loomPull carry the rules and their tests.
 */
export function LoomWorld({ view, onOpenReport }: CohortWorldProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const words = useLoomWords(view);
  const reduced = useReducedMotion();
  const [order, setOrder] = usePersistedChoice("kp-analyze-loom-order", isLoomOrder, "neutral");
  const threads = useMemo(() => threadsOf(view, order), [view, order]);
  const rows = useMemo(() => rowsOf(view), [view]);
  const nav = useLoomNav(rootRef);
  const [follow, setFollow] = useState<string | null>(null);
  const depth = nav.stack.length - 1;
  const top = nav.stack[depth];

  const step = (delta: 1 | -1) => {
    if (top?.level !== 1) return;
    nav.replaceTop({ level: 1, dimension: stepDimension(top.dimension, delta), focus: follow }, delta);
  };
  const go = (d: CohortDimension) => {
    if (top?.level !== 1 || d === top.dimension) return;
    const at = (x: CohortDimension) => rows.findIndex((r) => r.dimension === x);
    nav.replaceTop({ level: 1, dimension: d, focus: follow }, at(d) > at(top.dimension) ? 1 : -1);
  };
  useLoomKeys(rootRef, { level: top?.level ?? 0, onBack: nav.pop, onStep: step });
  useLoomPull(rootRef, nav.transition, reduced, nav.settle);

  const labelOf = (e: LoomEntry) => (e.level === 0 ? words.t("root") : words.dim(e.dimension));
  const crumbsFor = (stack: LoomStack, d: number) =>
    stack.slice(0, d + 1).map((e, i) => ({ label: labelOf(e), onSelect: i < d ? () => nav.popTo(i) : undefined }));

  const render = (entry: LoomEntry, d: number, stack: LoomStack): ReactElement => {
    if (entry.level === 0) {
      return (
        <LoomStage
          view={view}
          threads={threads}
          rows={rows}
          words={words}
          order={order}
          onOrder={setOrder}
          onOpenReport={onOpenReport}
          onPull={(dimension, memberId, el) => {
            setFollow(memberId);
            nav.push({ level: 1, dimension, focus: memberId }, el);
          }}
        />
      );
    }
    const row = rows.find((r) => r.dimension === entry.dimension) ?? rows[0];
    return (
      <LoomLevel
        view={view}
        dimension={entry.dimension}
        reading={row.reading}
        rated={row.rated}
        note={row.note}
        threads={threads}
        words={words}
        follow={follow}
        onFollow={setFollow}
        settled={nav.transition === null}
        crumbs={crumbsFor(stack, d)}
        onBack={nav.pop}
        onStep={step}
        onGo={go}
        onOpenReport={onOpenReport}
      />
    );
  };

  const layer = (entry: LoomEntry, d: number, mode: LayerMode, stack: LoomStack) => (
    <div key={layerKey(entry, d)} className="k-layer lm-layer" data-depth={d} data-mode={mode} hidden={mode === "hidden" || undefined} inert={mode === "under" || mode === "leaving" || undefined}>
      {render(entry, d, stack)}
    </div>
  );
  const layers = nav.stack.map((entry, d) => layer(entry, d, layerModeAt(d, depth, nav.kind), nav.stack));
  const tr = nav.transition;
  if (tr?.kind === "close") layers.push(layer(tr.ghost, tr.ghostDepth, "leaving", [...nav.stack, tr.ghost]));
  const pulled = tr?.kind === "open" ? top : tr?.kind === "close" ? tr.ghost : null;

  return (
    <div ref={rootRef} className="k-kit lm-loom" data-cohort-world="loom" data-members={view.members.length} data-level={top?.level ?? 0}>
      <p className="sr-only" role="status">
        {crumbsFor(nav.stack, depth).map((c) => c.label).join(" › ")}
      </p>
      {layers}
      {pulled?.level === 1 && !reduced ? (
        <div className="lm-ghost" data-loom-ghost="" aria-hidden>
          <LoomRail ghost dimension={pulled.dimension} reading={(rows.find((r) => r.dimension === pulled.dimension) ?? rows[0]).reading} threads={threads} words={words} follow={null} />
        </div>
      ) : null}
    </div>
  );
}
