"use client";

import type { CSSProperties } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatCount } from "../figure";
import type { StageTone } from "../types";
import { ShapeMark } from "./ShapeMark";
import type { Bead } from "./scaleModel";
import "./scale.css";

export type StageCell = {
  id: string;
  count: number;
  /** How many in this cell wait on you: a coral count beside the numeral, a halo on their beads. */
  waiting: number;
  /** Already capped (scaleModel.capBeads): the waiting ones first. */
  beads: readonly Bead[];
  /** How many the cap left out ("+N"). */
  more: number;
  /** The cell in words (its accessible name and tip): the row, the stage, the count, who waits. */
  aria: string;
};

/**
 * @catalog One row's stages as cells on a shared stage grid: a numeral per stage, a capped strip of provenance beads (waiting ones first, haloed), "+N" beyond the cap; a cell is a button.
 *
 * Built for a table's meta track (a board of many rows, one row per group): the head above sets the
 * same columns with StageCellsHead. Beads are decorative (the cell's name says it all), so a row of
 * five cells is five focus stops, not fifty. A zero is a measured zero: its numeral, no beads, inert.
 */
export function StageCells({ cells, picked, onCell }: { cells: readonly StageCell[]; picked?: string | null; onCell?: (id: string) => void }) {
  const t = useTranslations("kit.graphic.cells");
  const locale = useLocale();
  const n = (v: number) => formatCount(v, locale);
  return (
    <div className="k-cells" style={{ "--n": cells.length } as CSSProperties} data-part="stage-cells" data-role="kit-stage-cells">
      {cells.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`k-cells__c${picked === c.id ? " is-picked" : ""}${c.count ? "" : " is-zero"}`}
          aria-label={c.aria}
          aria-pressed={onCell ? picked === c.id : undefined}
          data-tip={c.aria}
          disabled={!onCell || !c.count}
          onClick={(e) => {
            e.stopPropagation();
            onCell?.(c.id);
          }}
          data-role="kit-stage-cell"
        >
          <span className="k-cells__n">
            <b className="k-nums">{n(c.count)}</b>
            {c.waiting ? <span className="k-cells__wait k-nums">{t("waiting", { count: c.waiting })}</span> : null}
          </span>
          {c.count ? (
            <span className="k-cells__beads" aria-hidden="true">
              <span className="k-cells__strip">
                {c.beads.map((b) => (
                  <span key={b.id} className={`k-cells__bead${b.needs ? " is-needs" : ""}`}>
                    <ShapeMark shape={b.shape} tone={b.tone} size={14} tip={null} />
                  </span>
                ))}
              </span>
              {c.more > 0 ? <span className="k-cells__more k-nums">{t("more", { count: c.more })}</span> : null}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/** The stage grid's head: each stage's name with its tone's shape, on the same columns as StageCells. */
export function StageCellsHead({ stages }: { stages: readonly { id: string; label: string; tone?: StageTone }[] }) {
  return (
    <div className="k-cells k-cells--head" style={{ "--n": stages.length } as CSSProperties} data-role="kit-stage-cells-head">
      {stages.map((s) => (
        <span key={s.id} className="k-cells__h">
          <ShapeMark shape="solid" tone={s.tone} size={14} tip={null} />
          <span>{s.label}</span>
        </span>
      ))}
    </div>
  );
}
