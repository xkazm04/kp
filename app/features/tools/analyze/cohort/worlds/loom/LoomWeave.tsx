"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { ScenePress } from "@/app/_components/kit/scene";
import type { CohortDimension } from "../../cohortTypes";
import { LoomKnot } from "./LoomKnot";
import { LoomThreads } from "./LoomThreads";
import { TAG_ANGLE, type LoomGeo } from "./loomGeometry";
import { bindingOf, knotOf, type RowReading, type Thread } from "./loomModel";
import { cursorKey, moveCursor, parseCursorKey, type Cursor } from "./loomNav";
import type { LoomWords } from "./useLoomWords";

type Row = { dimension: CohortDimension; reading: RowReading };

/**
 * Level 0's weave: the drawing (LoomThreads) and the controls laid over it on the same pixels, as an
 * ARIA grid. The tags are the column headers (a press opens the member's full report), the spools are
 * the row headers (a press pulls the row out), every crossing is a cell (a press pulls its row out,
 * following that member). One roving stop: arrows walk the grid, Home / End jump along a row, Tab
 * leaves it. Pointing or focusing reads a crossing: its thread pulls taut, its row lights.
 */
export function LoomWeave({ geo, threads, rows, words, cloth, reading, onRead, onPull, onOpenReport }: {
  geo: LoomGeo;
  threads: readonly Thread[];
  rows: readonly Row[];
  words: LoomWords;
  cloth: boolean;
  reading: Cursor | null;
  onRead: (c: Cursor | null) => void;
  onPull: (d: CohortDimension, memberId: string | null, el: HTMLElement) => void;
  onOpenReport: (slug: string) => void;
}) {
  const { t } = words;
  const ref = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<Cursor>({ row: 0, col: -1 });
  const stop = cursorKey(cursor);
  const hover = useRef<Cursor | null>(null);
  const focused = useRef<Cursor | null>(null);
  const read = () => onRead(hover.current ?? focused.current);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const from = parseCursorKey((e.target as HTMLElement).dataset?.loomKey) ?? cursor;
    const next = moveCursor(from, e.key, rows.length, threads.length);
    if (!next) return;
    e.preventDefault();
    ref.current?.querySelector<HTMLElement>(`[data-loom-key="${cursorKey(next)}"]`)?.focus();
  };
  const cursorOf = (el: EventTarget | null) => parseCursorKey((el as HTMLElement | null)?.closest?.<HTMLElement>("[data-loom-key]")?.dataset.loomKey);

  return (
    <div
      ref={ref}
      className="lm-weave"
      role="grid"
      aria-label={t("weaveLabel")}
      aria-rowcount={rows.length + 1}
      aria-colcount={threads.length + 1}
      style={{ height: geo.height }}
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        const c = cursorOf(e.target);
        if (!c) return;
        setCursor(c);
        focused.current = c;
        read();
      }}
      onBlur={(e) => {
        if (ref.current?.contains(e.relatedTarget as Node | null)) return;
        focused.current = null;
        read();
      }}
      onPointerOver={(e) => {
        hover.current = cursorOf(e.target);
        read();
      }}
      onPointerLeave={() => {
        hover.current = null;
        read();
      }}
    >
      <LoomThreads geo={geo} threads={threads} rows={rows} hotCol={reading && reading.col >= 0 ? reading.col : null} hotRow={reading && reading.row >= 0 ? reading.row : null} cloth={cloth} />
      <div role="row" aria-rowindex={1}>
        {threads.map((th) => {
          const key = cursorKey({ row: -1, col: th.col });
          const slug = th.member.analysisSlug;
          return (
            <div key={th.member.memberId} role="columnheader" aria-colindex={th.col + 2} className="lm-tag-cell" style={{ transform: `translate(${geo.xs[th.col]}px, ${geo.beam - 10}px) rotate(-${TAG_ANGLE}deg)` }}>
              <ScenePress
                className="lm-tag"
                data-loom-key={key}
                data-state={th.state}
                data-slack={th.slack || undefined}
                data-membership={th.member.membership}
                data-hot={reading?.col === th.col || undefined}
                tabIndex={stop === key ? 0 : -1}
                aria-label={words.tagName(th.member)}
                aria-disabled={slug ? undefined : true}
                style={{ maxWidth: geo.tagMax[th.col] }}
                onClick={() => slug && onOpenReport(slug)}
              >
                <span className="lm-tag__eye" aria-hidden />
                <span className="lm-tag__name">{th.member.label}</span>
              </ScenePress>
            </div>
          );
        })}
      </div>
      {rows.map((row, r) => {
        const y = geo.ys[r];
        const spool = cursorKey({ row: r, col: -1 });
        const name = words.dim(row.dimension);
        const claim = words.claim(row.reading);
        return (
          <div key={row.dimension} role="row" aria-rowindex={r + 2}>
            <div role="rowheader" aria-colindex={1} className="lm-spool-cell" style={{ transform: `translate(0px, ${y - 28}px)`, width: geo.gutter - 22 }}>
              <ScenePress
                className="lm-spool"
                data-loom-key={spool}
                data-loom-row={row.dimension}
                data-kind={row.reading.kind}
                data-hot={reading?.row === r || undefined}
                tabIndex={stop === spool ? 0 : -1}
                aria-label={t("aria.row", { dim: name, claim })}
                onClick={(e) => onPull(row.dimension, null, e.currentTarget)}
              >
                <span className="lm-spool__name">{name}</span>
                <span className="lm-spool__claim">{claim}</span>
              </ScenePress>
            </div>
            {threads.map((th) => {
              const key = cursorKey({ row: r, col: th.col });
              const knot = knotOf(th.member.cells[row.dimension]);
              return (
                <div key={th.member.memberId} role="gridcell" aria-colindex={th.col + 2} className="lm-cross-cell" style={{ transform: `translate(${geo.xs[th.col] - geo.knotW / 2}px, ${y - 16}px)`, width: geo.knotW }}>
                  <ScenePress
                    className="lm-cross"
                    data-loom-key={key}
                    data-loom-row={row.dimension}
                    data-state={th.state}
                    tabIndex={stop === key ? 0 : -1}
                    aria-label={words.knotName(th.member, row.dimension)}
                    onClick={(e) => onPull(row.dimension, th.member.memberId, e.currentTarget)}
                  >
                    <LoomKnot knot={knot} bind={bindingOf(row.reading, th.member.memberId)} />
                  </ScenePress>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
