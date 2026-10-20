"use client";

import type { CSSProperties, ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Column } from "./DataTable";
import { columnTrack, foldClass } from "./tracks";
import { flowRowClass, flowVars, type FlowRowState } from "./flow";
import { Measure } from "./Measure";
import { Mark } from "./Mark";
import "./kit.css";

/**
 * @catalog A short table in flow (a settings matrix): DataTable's head, tracks and fold order, every row in the DOM and editable, rows growing for an optional detail line; changed / error edges; no viewport, no pager.
 */
export function FlowTable<T>({
  rows, columns, cells, rowKey, rowState, detail, metaSplit, nameTrack, label, emptyText,
}: {
  rows: readonly T[];
  columns: Column[];
  /** One cell per column, in column order. */
  cells: (row: T) => ReactNode[];
  rowKey: (row: T) => string;
  rowState?: (row: T) => FlowRowState[];
  /** A second line under a row, from the name track to the end (an expanded editor); null = none. */
  detail?: (row: T) => ReactNode;
  /** Subdivide the meta track (DataTable `metaSplit`); meta+N columns fold first. */
  metaSplit?: string;
  /** The name track's width, e.g. "minmax(0, 20%)"; the measure's own by default. */
  nameTrack?: string;
  label: string;
  emptyText: string;
}) {
  const t = useTranslations("kit");
  const style = flowVars(metaSplit, nameTrack) as CSSProperties;
  return (
    <div className="k-table k-flow" data-part="flow-table" role="table" aria-label={label}>
      <Measure className="k-table__head" style={style} role="row" data-role="kit-table-head">
        {columns.map((c) => (
          <div
            key={c.id}
            className={`k-th${c.numeric ? " is-num" : ""}${foldClass(c.track)}`}
            role="columnheader"
            style={{ gridColumn: columnTrack(c.track) }}
            data-tip={c.tip}
            tabIndex={c.tip ? 0 : undefined}
          >
            {c.label}
          </div>
        ))}
      </Measure>
      {rows.length === 0 ? (
        <Measure className="k-table__row k-row k-flow__row is-ghost" style={style}>
          <div className="k-row__mark"><Mark kind="unknown" tip={t("emptyMark")} /></div>
          <div className="k-td" style={{ gridColumn: "name / end" }}>{emptyText}</div>
        </Measure>
      ) : (
        rows.map((r) => {
          const content = cells(r);
          const more = detail?.(r) ?? null;
          return (
            <Measure key={rowKey(r)} className={flowRowClass(rowState?.(r) ?? [], more != null)} style={style} role="row" data-role="kit-flow-row">
              {columns.map((c, ci) => (
                <div
                  key={c.id}
                  role="cell"
                  className={`k-td${c.primary ? " is-primary" : ""}${c.quiet ? " is-quiet" : ""}${c.numeric ? " is-num" : ""}${foldClass(c.track)}`}
                  style={{ gridColumn: columnTrack(c.track) }}
                >
                  {content[ci]}
                </div>
              ))}
              {more != null ? <div className="k-flow__detail" data-role="kit-flow-detail">{more}</div> : null}
            </Measure>
          );
        })
      )}
    </div>
  );
}
