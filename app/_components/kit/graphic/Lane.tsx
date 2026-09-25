"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { ShapeKind, StageTone } from "../types";
import { laneEnds } from "./railModel";
import { ShapeMark } from "./ShapeMark";
import "./graphic.css";

export type LaneCell = { shape: ShapeKind; tone?: StageTone; tip: string };

/**
 * @catalog One row's path drawn on a StageRail's columns: a tile per step (shape = provenance) and a path line from the first reached step to the last.
 *
 * The row is the focus target, not the tiles; every tile's fact is repeated in the reading pane's
 * column rail. `arriving` is the caller's: true only for ~1 s after a data change, never on scroll (a
 * windowed table mounts rows as they scroll in, and those must not sweep).
 */
export function Lane({ cells, arriving = false }: { cells: readonly LaneCell[]; arriving?: boolean }) {
  const t = useTranslations("kit.graphic.lane");
  const ends = laneEnds(cells);
  if (!cells.some((c) => c.shape !== "none")) {
    return <span className="k-lane__none" data-part="lane">{t("nothing")}</span>;
  }
  const style = { "--n": cells.length, "--a": ends?.first ?? 0, "--b": ends?.last ?? 0 } as CSSProperties;
  return (
    <div className={`k-lane${arriving ? " is-arriving" : ""}`} style={style} data-empty={ends ? undefined : "1"} data-part="lane" data-role="kit-lane">
      {cells.map((c, i) => (
        <span key={i} className="k-lane__c" style={{ "--i": i } as CSSProperties}>
          <ShapeMark shape={c.shape} tone={c.tone} tip={c.tip} />
        </span>
      ))}
    </div>
  );
}
