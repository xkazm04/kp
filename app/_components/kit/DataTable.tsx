"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { PartState, RowState } from "./types";
import { columnTrack, foldClass, type TableTrack } from "./tracks";
import { foldedTracks, rowWindow, scrollToRow } from "./windowing";
import { Measure } from "./Measure";
import { Mark } from "./Mark";
import { Note } from "./Section";
import { Button } from "./Button";
import { DataTablePager } from "./DataTablePager";
import "./kit.css";

export type Column = {
  id: string;
  label: string;
  track: TableTrack;
  numeric?: boolean;
  /** Tip on the column head (hover and focus). */
  tip?: string;
  /** Two-line primary cell: the row's one weight-600 name + a quiet small line. */
  primary?: boolean;
  quiet?: boolean;
};

type Props<T> = {
  rows: T[];
  columns: Column[];
  /** One cell per column, in column order. */
  cells: (row: T) => ReactNode[];
  rowKey: (row: T) => string;
  rowState?: (row: T) => RowState[];
  /** The viewport is exactly this many rows tall. */
  visibleRows?: number;
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  state?: PartState;
  emptyText: string;
  loadingText?: string;
  errorText?: string;
  onRetry?: () => void;
  /** Subdivide the meta track, e.g. "minmax(0,1fr) 200px"; address the parts as "meta+1"... */
  metaSplit?: string;
  label: string;
  pagerExtra?: ReactNode;
  /** Change it when the rows are re-cut (a filter): the viewport returns to the top. */
  resetKey?: string;
};

/**
 * @catalog The windowed table on the measure: sticky head, fixed-height rows, a viewport exactly N rows tall where only the visible rows plus 3 exist in the DOM, the pager directly under the last row. Empty = one ghost row naming what lands there.
 */
export function DataTable<T>({
  rows, columns, cells, rowKey, rowState, visibleRows = 12, selectedKey, onSelect, state = "ready",
  emptyText, loadingText, errorText, onRetry, metaSplit, label, pagerExtra, resetKey,
}: Props<T>) {
  const t = useTranslations("kit");
  const tc = useTranslations("common");
  const viewport = useRef<HTMLDivElement>(null);
  const spacer = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState({ top: 0, vh: 0, rh: 0 });
  const total = rows.length;
  const vis = Math.max(1, Math.min(total, visibleRows));
  const meta = metaSplit ?? "minmax(0,1fr)";
  const style = { "--t-meta": meta, "--t-meta0": foldedTracks(meta) } as CSSProperties;

  const measure = useCallback(() => {
    const vp = viewport.current;
    const sp = spacer.current;
    if (!vp || !sp) return;
    setMetrics({ top: vp.scrollTop, vh: vp.clientHeight, rh: sp.offsetHeight / Math.max(1, total) });
  }, [total]);

  useLayoutEffect(() => {
    measure();
    const vp = viewport.current;
    if (!vp) return;
    let raf = 0;
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; measure(); });
    };
    const ro = new ResizeObserver(() => measure());
    ro.observe(vp);
    vp.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      vp.removeEventListener("scroll", onScroll);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [measure, state]);

  useEffect(() => {
    if (viewport.current) viewport.current.scrollTop = 0;
  }, [resetKey]);

  // A keyboard step can move the selection off screen: bring it back, the shortest way.
  useEffect(() => {
    const vp = viewport.current;
    if (!vp || selectedKey == null || !metrics.rh) return;
    const index = rows.findIndex((r) => rowKey(r) === selectedKey);
    if (index < 0) return;
    const next = scrollToRow(index, vp.scrollTop, vp.clientHeight, metrics.rh);
    if (next != null) vp.scrollTop = next;
  }, [selectedKey, rows, rowKey, metrics.rh]);

  const win = rowWindow(metrics.top, metrics.vh, metrics.rh, total);

  const head = (
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
  );

  let body: ReactNode;
  if (state === "loading") {
    body = <div className="k-section__placeholder" role="status">{loadingText ?? tc("loading")}</div>;
  } else if (state === "error") {
    body = (
      <Note tone="critical" action={onRetry ? <Button label={tc("retry")} variant="ghost" size="sm" onClick={onRetry} /> : null}>
        {errorText}
      </Note>
    );
  } else if (!total) {
    body = (
      <Measure className="k-table__row k-row is-ghost" style={{ ...style, height: "var(--row2-h)" }}>
        <div className="k-row__mark"><Mark kind="unknown" tip={t("emptyMark")} /></div>
        <div className="k-td" style={{ gridColumn: "name / end" }}>{emptyText}</div>
      </Measure>
    );
  } else {
    const slice: ReactNode[] = [];
    for (let i = win.start; i < win.end; i++) {
      const r = rows[i];
      const key = rowKey(r);
      const st = [...(rowState?.(r) ?? []), ...(key === selectedKey ? (["selected"] as const) : [])];
      const content = cells(r);
      slice.push(
        <Measure
          key={key}
          className={`k-table__row k-row${st.map((s) => ` is-${s}`).join("")}`}
          style={style}
          role="row"
          aria-selected={key === selectedKey}
          data-select={key}
          data-role="kit-table-row"
          onClick={onSelect ? () => onSelect(key) : undefined}
        >
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
        </Measure>,
      );
    }
    body = (
      <div
        ref={viewport}
        className={`k-table__viewport${total <= vis ? " is-fit" : ""}`}
        style={{ height: `calc(var(--row2-h) * ${vis})` }}
        tabIndex={0}
        aria-label={label}
      >
        <div ref={spacer} className="k-table__spacer" style={{ height: `calc(var(--row2-h) * ${total})` }}>
          <div className="k-table__slice" style={{ transform: `translateY(${win.offset}px)` }}>{slice}</div>
        </div>
      </div>
    );
  }

  const page = (dir: 1 | -1) => viewport.current && (viewport.current.scrollTop += dir * viewport.current.clientHeight);
  return (
    <div className={`k-table${!total ? " is-empty" : ""}`} data-part="data-table" role="table" aria-label={label}>
      {head}
      {body}
      {total && state === "ready" ? (
        <DataTablePager from={win.from || 1} to={win.to || vis} total={total} domRows={win.end - win.start} extra={pagerExtra} onPage={page} />
      ) : null}
    </div>
  );
}
