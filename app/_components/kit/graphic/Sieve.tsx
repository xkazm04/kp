"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { Button } from "../Button";
import { Mark } from "../Mark";
import { formatCount } from "../figure";
import type { PartState } from "../types";
import { ShapeMark } from "./ShapeMark";
import { countByLayer, type SieveItem } from "./sieveLayout";
import { useSieveField } from "./useSieveField";
import { drawsBars, sieveBars } from "./scaleModel";
import { SieveBarField } from "./SieveBarField";
import "./graphic.css";

export type SieveLayer = {
  id: string;
  label: string;
  /** One line under the label (the layer's own fact: who waits, how they got here). */
  sub?: ReactNode;
  mark?: ReactNode;
  time?: ReactNode;
  timeTip?: string;
  act?: ReactNode;
  /** The layer items leave by (drawn under a dashed rule, its name quiet). */
  exit?: boolean;
  /** Names who would stand here when nobody does ("Nobody at Offer"). */
  empty: string;
  /** The layer's facts in words (its sub-line and its age) as the label's tip: on a narrow sheet the
   *  sub-line and the time track fold into it, so the label is never the only place they were. */
  tip?: string;
};

/**
 * @catalog Items pour through named layers as dots (shape = how they got there), one layer per measure row, counters ticking as they land; a layer is a filter button.
 *
 * Layers sit ON the measure: label on the name track, the dot field on meta, the count on fig, an age
 * on time, an action on act. The pour plays once per `replayKey` (reduced motion: final frame). Items
 * are reached through the caller's linked list, never through dots; above `budget` one dot stands for
 * ceil(n / budget) items and prints its count. Above `barsAbove` (unset = never) no dots are drawn at
 * all: each layer draws its count as a proportional bar and its shapes as a legend-sized sample
 * (scaleModel.ts), which is what a field of thousands reads as.
 */
export function Sieve({
  id, layers, items, selected, dim, selectedItem, onLayer, budget = 400, barsAbove, state = "ready", replayKey,
  legend, pouredLabel, loadingText, errorText, onRetry,
}: {
  id: string;
  layers: readonly SieveLayer[];
  items: readonly SieveItem[];
  selected?: string | null;
  dim?: ReadonlySet<string>;
  selectedItem?: string | null;
  onLayer: (layerId: string) => void;
  budget?: number;
  /** Above this many items, bars instead of dots (additive: unset keeps the dots at every size). */
  barsAbove?: number;
  state?: PartState;
  replayKey: string;
  legend?: ReactNode;
  /** The words after the total on the pour line (default "poured in"). */
  pouredLabel?: string;
  loadingText?: string;
  errorText?: string;
  onRetry?: () => void;
}) {
  const t = useTranslations("kit.graphic.sieve");
  const tc = useTranslations("common");
  const locale = useLocale();
  const reduced = useReducedMotion();
  const format = (n: number) => formatCount(n, locale);
  const ids = layers.map((l) => l.id);
  const per = countByLayer(ids, items);
  const ready = state === "ready";
  const bars = drawsBars(items.length, barsAbove) ? sieveBars(ids, items, dim) : null;
  const { boxRef, svgRef } = useSieveField({
    id, layerIds: ids, items, dim, picked: selectedItem ?? undefined, replayKey, budget, reduced, format, enabled: ready && !bars,
  });
  const press = (layerId: string) => (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onLayer(layerId);
  };

  return (
    <div ref={boxRef} className={`k-sieve${ready ? "" : ` is-${state}`}${bars ? " is-bars" : ""}`} data-part="sieve" data-role="kit-sieve">
      <div className="k-sieve__pour k-measure">
        <div className="k-row__mark"><ShapeMark shape="solid" tone="accepted" tip={null} /></div>
        <div className="k-sieve__lt"><b className="k-nums">{format(items.length)}</b> {pouredLabel ?? t("poured")}</div>
        <div className="k-sieve__legend">{legend}</div>
      </div>
      {state === "loading" ? (
        <div className="k-section__placeholder">{loadingText ?? t("loading")}</div>
      ) : state === "error" ? (
        <div className="k-note k-note--critical" role="alert">
          <Mark kind="fail" />
          <span>{errorText ?? t("error")}</span>
          {onRetry ? <Button label={tc("retry")} variant="ghost" size="sm" onClick={onRetry} /> : null}
        </div>
      ) : (
        layers.map((L) => {
          const sel = selected === L.id;
          const count = per[L.id] ?? 0;
          return (
            <div
              key={L.id}
              className={`k-sieve__layer k-row k-measure${L.exit ? " is-exit" : ""}${sel ? " is-selected" : ""}${count ? "" : " is-empty"}`}
              role="button"
              tabIndex={0}
              aria-pressed={sel}
              aria-label={t("layerAria", { label: L.label, count })}
              onClick={() => onLayer(L.id)}
              onKeyDown={press(L.id)}
              data-role="kit-sieve-layer"
            >
              <div className="k-row__mark">{L.mark}</div>
              <div className="k-row__name" data-role="kit-sieve-label" data-tip={L.tip}>
                {L.label}
                {L.sub ? <small>{L.sub}</small> : null}
              </div>
              <div className="k-sieve__field" data-sv-field={L.id}>
                {!count ? <span className="k-absent">{L.empty}</span> : bars?.[L.id] ? <SieveBarField bar={bars[L.id]} /> : null}
              </div>
              <div className="k-row__fig k-sieve__n" data-role="kit-sieve-count">
                <b data-sv-count={L.id}>{format(count)}</b>
              </div>
              <div className="k-row__time" data-tip={L.timeTip} tabIndex={L.timeTip ? -1 : undefined}>{L.time}</div>
              <div className="k-row__acts">{L.act}</div>
            </div>
          );
        })
      )}
      {ready && !bars ? <svg ref={svgRef} className="k-sieve__dots" aria-hidden="true" /> : null}
    </div>
  );
}
