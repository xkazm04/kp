"use client";

// The Console prototype world (spark analyze-v2-cohort WP7): the cohort as a mixing desk. Channel
// strips are members, buses are dimensions, the master section carries the overall claim, and a
// bus's SOLO key mutes the rest and widens that bus into the shared DimensionPage. The pure halves
// are consoleModel.ts (what the desk may say) and consoleNav.ts (levels, desk keys, solo geometry).
import { useRef, useState, type ReactElement } from "react";
import type { Crumb } from "@/app/_components/kit/scene";
import { layerModeAt } from "@/app/_components/kit/scene/levelStack";
import type { CohortWorldProps } from "../../cohortTypes";
import type { PatchOrder } from "./consoleModel";
import { layerKey, topOf, type ConsoleEntry, type ConsoleStack } from "./consoleNav";
import { ConsoleDesk } from "./ConsoleDesk";
import { ConsoleLayer } from "./ConsoleLayer";
import { ConsoleSoloLevel } from "./ConsoleSoloLevel";
import { useConsoleKeys } from "./useConsoleKeys";
import { useConsoleNav } from "./useConsoleNav";
import { useConsoleWords } from "./useConsoleWords";
import "@/app/_components/kit/kit.css";
import "./console.css";

export function ConsoleWorld({ view, onOpenReport }: CohortWorldProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const words = useConsoleWords();
  const nav = useConsoleNav(rootRef);
  const [order, setOrder] = useState<PatchOrder>("neutral");
  const depth = nav.stack.length - 1;
  const top = topOf(nav.stack);
  const tr = nav.transition;
  useConsoleKeys(rootRef, { level: top.level, onBack: nav.pop, onStep: nav.step });

  // The bus the desk mutes for: the soloed one, and the one closing until its band has landed.
  const solo = top.level === 1 ? top.dimension : tr?.kind === "close" && tr.ghost.level === 1 ? tr.ghost.dimension : null;

  const labelOf = (e: ConsoleEntry) => (e.level === 0 ? words.t("root") : words.dim(e.dimension));
  const crumbsFor = (stack: ConsoleStack, d: number): Crumb[] =>
    stack.slice(0, d + 1).map((e, i) => ({ label: labelOf(e), onSelect: i < d ? () => nav.popTo(i) : undefined }));

  const render = (entry: ConsoleEntry, d: number, stack: ConsoleStack): ReactElement => {
    if (entry.level === 0) {
      return (
        <ConsoleDesk
          view={view}
          words={words}
          order={order}
          onOrder={setOrder}
          solo={solo}
          onSolo={(dimension, focus, el) => nav.push({ level: 1, dimension, focus }, el)}
          onOpenReport={onOpenReport}
        />
      );
    }
    return (
      <ConsoleSoloLevel
        view={view}
        words={words}
        dimension={entry.dimension}
        focus={entry.focus}
        order={order}
        crumbs={crumbsFor(stack, d)}
        onBack={nav.pop}
        onGo={nav.go}
        onFocusMember={nav.refocus}
        onOpenReport={onOpenReport}
      />
    );
  };

  const layers = nav.stack.map((entry, d) => (
    <ConsoleLayer
      key={layerKey(entry, d)}
      depth={d}
      mode={layerModeAt(d, depth, tr?.kind ?? null)}
      opener={d === depth ? nav.openers[d] ?? null : null}
      dir={tr?.kind === "swap" ? tr.dir : 1}
      onSettled={d === depth ? nav.settle : undefined}
    >
      {render(entry, d, nav.stack)}
    </ConsoleLayer>
  ));
  if (tr?.kind === "close") {
    layers.push(
      <ConsoleLayer key={layerKey(tr.ghost, tr.ghostDepth)} depth={tr.ghostDepth} mode="leaving" opener={tr.opener} onSettled={nav.settle}>
        {render(tr.ghost, tr.ghostDepth, tr.from)}
      </ConsoleLayer>,
    );
  }

  return (
    <div
      ref={rootRef}
      className="k-kit cx-console"
      data-cohort-world="console"
      data-members={view.members.length}
      data-level={top.level}
      data-status={view.status}
    >
      <p className="sr-only" role="status">
        {crumbsFor(nav.stack, depth).map((c) => c.label).join(" › ")}
      </p>
      {layers}
    </div>
  );
}
