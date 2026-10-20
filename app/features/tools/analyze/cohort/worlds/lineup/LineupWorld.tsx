"use client";

import { useMemo, useRef, type ReactElement } from "react";
import { layerModeAt, type Crumb } from "@/app/_components/kit/scene";
import { usePersistedChoice } from "@/app/features/hiring/pipeline/orbit/usePersistedChoice";
import type { CohortDimension, CohortWorldProps } from "../../cohortTypes";
import { CorridorLayer } from "./CorridorLayer";
import { LineupFloorLevel } from "./LineupFloorLevel";
import { LineupStreetLevel } from "./LineupStreetLevel";
import { isStreetOrder, stepDimension, streetOrder } from "./lineupModel";
import { layerKey, topOf, type LineupEntry, type LineupStack } from "./lineupNav";
import { useLineupKeys } from "./useLineupKeys";
import { useLineupNav } from "./useLineupNav";
import { useLineupWords } from "./useLineupWords";
import "./lineup.css";

/**
 * Analyze > Cohort, "The Line-up": the candidates stand side by side as a skyline. Level 0 is the street
 * (tower = fit, floors = the other dimensions, lit windows = ratings, boarded floors = absences with their
 * reasons, haze where the order is not a lead); a floor press walks into that floor across every building:
 * the floor's band grows into level 1 (this world's corridor, CorridorLayer), where the lift takes the
 * stairs between dimensions and the shared DimensionPage reads the floor. This shell owns the stack, the
 * keys, the words and the announcement of where you are; the street's own state lives in its level.
 */
export function LineupWorld({ view, onOpenReport }: CohortWorldProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const words = useLineupWords(view);
  const nav = useLineupNav(rootRef);
  const [order] = usePersistedChoice("kp-analyze-lineup-order", isStreetOrder, "fit");
  const street = useMemo(() => streetOrder(view.members, order), [view.members, order]);
  const depth = nav.stack.length - 1;
  const top = topOf(nav.stack);

  useLineupKeys(rootRef, {
    level: top.level,
    onBack: nav.pop,
    onStairs: (delta) => {
      if (top.level === 1) nav.toFloor(stepDimension(top.dimension, delta));
    },
  });

  /** Where the street draws a floor's band: the corridor opens from it and closes back into it. */
  const bandOf = (d: CohortDimension) => `.k-layer[data-depth="0"] [data-lu-band="${d}"]`;
  const labelOf = (e: LineupEntry) => (e.level === 0 ? words.t("level.root") : words.dim(e.dimension));
  const crumbsFor = (stack: LineupStack, d: number): Crumb[] =>
    stack.slice(0, d + 1).map((e, i) => ({ label: labelOf(e), onSelect: i < d ? nav.pop : undefined }));

  const render = (entry: LineupEntry, d: number, stack: LineupStack): ReactElement =>
    entry.level === 0 ? (
      <LineupStreetLevel
        view={view}
        words={words}
        walking={nav.walking}
        onWalk={(dimension, el, focus) => nav.push({ level: 1, dimension, focus }, el)}
        onOpenReport={onOpenReport}
      />
    ) : (
      <LineupFloorLevel
        view={view}
        street={street}
        dimension={entry.dimension}
        focus={entry.focus}
        words={words}
        crumbs={crumbsFor(stack, d)}
        onBack={nav.pop}
        onFloor={nav.toFloor}
        onFocusMember={nav.setFocusMember}
        onOpenReport={onOpenReport}
      />
    );

  const tr = nav.transition;
  const layers = nav.stack.map((entry, d) => (
    <CorridorLayer
      key={layerKey(entry, d)}
      depth={d}
      mode={layerModeAt(d, depth, nav.kind)}
      band={d === depth && entry.level === 1 ? bandOf(entry.dimension) : null}
      dir={tr?.kind === "swap" ? tr.dir : 1}
      onSettled={d === depth ? nav.settle : undefined}
    >
      {render(entry, d, nav.stack)}
    </CorridorLayer>
  ));
  if (tr?.kind === "close") {
    // The closing floor keeps its key, so React keeps its instance while the corridor closes into its band.
    layers.push(
      <CorridorLayer key={layerKey(tr.ghost, tr.ghostDepth)} depth={tr.ghostDepth} mode="leaving" band={bandOf(tr.floor)} onSettled={nav.settle}>
        {render(tr.ghost, tr.ghostDepth, tr.from)}
      </CorridorLayer>,
    );
  }

  return (
    <div
      ref={rootRef}
      className="k-kit lu-world"
      data-cohort-world="lineup"
      data-members={view.members.length}
      data-level={top.level}
      data-walking={nav.walking ?? undefined}
    >
      <p className="sr-only" role="status">
        {crumbsFor(nav.stack, depth)
          .map((c) => c.label)
          .join(" › ")}
      </p>
      {layers}
    </div>
  );
}
