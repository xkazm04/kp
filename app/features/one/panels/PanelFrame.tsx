"use client";

// The ONE surface every /one panel renders in, whatever its data (docs/design/one-interface.md
// "Panel looks"). A panel component reads its data and hands this frame a `PanelData`
// (columns + rows + headline); the frame draws it three ways:
//
//   table    fills its container. One PANEL surface: head, sticky column head, dense (44px)
//            rows on one CSS grid template, the body scrolls inside the panel. Rows take
//            keyboard focus (↑ ↓ move, Enter selects).
//   summary  a compact card: headline figure, ≤ 3 rows, See all. Never scrolls.
//   list     a dense single column for a narrow side: a line + a meta line per item.
//   default / compact / spotlight (round 1, Greet) = the list drawn BARE — the host's own
//            className is the frame, so there is never a frame inside a frame.
//
// A panel is one surface: the frame paints the border, the host's className only places and
// sizes it (h-full, a grid cell). Loading is a quiet LoadingGap, error is a critical Note
// with a retry whose text is resolved from the read's CODE (useErrorMessage) — the server's
// English `error` never renders.
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { Button, Mark, Note, type MarkKind } from "@/app/_components/kit";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { CHIP_QUIET, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { WorkspaceTabId } from "@/app/features/shell/tabs";
import { consoleHref } from "./PanelShell";
import type { Read } from "./read";
import type { PanelProps } from "./types";

/** One table column: `track` is its CSS grid track ("minmax(0,1fr)", "6rem"). */
export type Col = { key: string; label: string; track: string; end?: boolean };

export type PanelRow = {
  key: string;
  /** Table cells by column key. */
  cells: Record<string, ReactNode>;
  /** List / summary: the one-line primary text, and the line under it. */
  line: ReactNode;
  meta?: ReactNode;
  /** List / summary: the figure at the line's right edge. */
  trail?: ReactNode;
  /** The row's own acts (Advance / Reject) — always drawn. */
  acts?: ReactNode;
  /** The row's Console door — drawn on hover / focus in the table, left out of the list. */
  door?: ReactNode;
  mark?: MarkKind;
  tone?: "needs" | "caution";
  onSelect?: () => void;
};

export type PanelData = {
  title: string;
  /** A numeral beside the title; absent = not shown (never a 0 the read did not return). */
  count?: number | string | null;
  state?: string;
  /** Summary look: the one big figure and its caption. */
  headline?: { figure: ReactNode; label?: string };
  console?: { tab: WorkspaceTabId; params?: Record<string, string>; label?: string };
  read: Read<unknown> & { retry: () => void };
  cols: Col[];
  /** The width of the acts + door column ("0" = none). Fixed, so every row aligns. */
  actsTrack?: string;
  rows: PanelRow[];
  /** A stated empty state, shown when the read is ready and there are no rows. */
  empty?: string;
  /** Above the rows (a relay-off warning). */
  note?: ReactNode;
  /** Under the rows ("Showing the first 8 of 12."). */
  foot?: string;
};

const SUMMARY_ROWS = 3;

/** The primary table cell: name over subline, an optional lead mark. */
export function NameCell({ name, sub, mark }: { name: ReactNode; sub?: ReactNode; mark?: MarkKind }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {mark ? <Mark kind={mark} /> : null}
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-micro font-semibold leading-5 text-ink">{name}</span>
        {sub ? <span className="truncate text-micro leading-5 text-steel">{sub}</span> : null}
      </span>
    </span>
  );
}

/** A quiet tag in a cell (a stage). */
export function CellTag({ children }: { children: ReactNode }) {
  return <span className={`${CHIP_QUIET} max-w-full truncate`}>{children}</span>;
}

export function PanelFrame({ props, data }: { props: PanelProps; data: PanelData }) {
  const t = useTranslations("one.core.panels");
  const errMsg = useErrorMessage();
  const { panel, look = "default", className = "", chrome, onExpand } = props;
  const { read } = data;
  const bare = look === "default" || look === "compact" || look === "spotlight";
  const surface = bare ? "flex min-h-0 flex-col" : look === "summary" ? `${PANEL} flex flex-col` : `${PANEL} flex min-h-0 flex-col overflow-hidden`;
  const ready = read.state === "ready";
  const consoleLink = data.console ? (
    <Link className="k-btn k-btn--link k-btn--sm" href={consoleHref(data.console.tab, data.console.params)} data-role="one-console-link">
      {data.console.label ?? t("openInConsole")}
    </Link>
  ) : null;

  const body = (): ReactNode => {
    if (read.state === "loading") return <LoadingGap className="m-4 min-h-16" />;
    if (read.state === "error") {
      return (
        <div className="p-3">
          <Note tone="critical" action={<Button label={t("retry")} variant="ghost" size="sm" onClick={read.retry} />}>
            {errMsg(read.payload, t("loadFailed"))}
          </Note>
        </div>
      );
    }
    const empty = data.rows.length === 0;
    if (empty) {
      return (
        <>
          {data.note}
          <p className="px-4 py-6 text-body text-steel" data-role="one-empty">
            {data.empty ?? t("notReturned")}
          </p>
        </>
      );
    }
    if (look === "table") return <TableBody data={data} />;
    if (look === "summary") return <SummaryBody data={data} onExpand={onExpand} consoleLink={consoleLink} />;
    return <ListBody data={data} />;
  };

  const dense = look === "list" || bare;
  return (
    <section
      className={`${surface} ${className}`}
      data-one-panel={panel.kind}
      data-panel-id={panel.id}
      data-look={look}
      data-pinned={panel.pinned ? "true" : undefined}
      aria-label={data.title}
    >
      <div className={`flex shrink-0 items-center gap-3 border-b border-stone-200 dark:border-b-2 ${dense ? "min-h-11 px-3 py-1" : "min-h-12 px-4 py-1.5"}`}>
        <h3 className="min-w-0 truncate font-serif text-h3 text-ink dark:font-bold" data-role="one-panel-title">
          {data.title}
        </h3>
        {ready && data.count != null ? (
          <span className="k-nums text-micro text-steel" data-role="one-panel-count">
            {data.count}
          </span>
        ) : null}
        {data.state ? (
          <span className="min-w-0 flex-1 truncate text-micro text-steel" data-tip={data.state} tabIndex={0}>
            {data.state}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        <div className="flex shrink-0 items-center gap-1">
          {look === "table" || bare ? consoleLink : null}
          {chrome}
        </div>
      </div>
      {body()}
      {look === "list" && ready && consoleLink ? <div className="flex shrink-0 border-t border-stone-200 px-2 py-1 dark:border-dashed">{consoleLink}</div> : null}
    </section>
  );
}

/* ── table ─────────────────────────────────────────────────────────────────── */

function TableBody({ data }: { data: PanelData }) {
  const template = [...data.cols.map((c) => c.track), ...(data.actsTrack && data.actsTrack !== "0" ? [data.actsTrack] : [])].join(" ");
  const style: CSSProperties = { gridTemplateColumns: template };
  const hasActs = data.actsTrack != null && data.actsTrack !== "0";

  const onKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const target = e.target as HTMLElement;
    if (!target.matches("[data-row]")) return;
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-row]"));
    const next = rows[rows.indexOf(target) + (e.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    next.focus();
  };

  return (
    <>
      {data.note ? <div className="shrink-0 px-3 pt-3">{data.note}</div> : null}
      <div className="min-h-0 flex-1 overflow-auto" role="table" aria-label={data.title} onKeyDown={onKeys} data-role="one-table">
        <div className="min-w-[34rem]">
          <div role="row" className="sticky top-0 z-10 grid h-9 items-center gap-x-4 border-b border-stone-200 bg-white px-4 dark:border-b-2" style={style}>
            {data.cols.map((c) => (
              <div key={c.key} role="columnheader" className={`${META_LABEL} truncate ${c.end ? "text-right" : ""}`}>
                {c.label}
              </div>
            ))}
            {hasActs ? <div role="presentation" /> : null}
          </div>
          {data.rows.map((r) => (
            <div
              key={r.key}
              role="row"
              data-row
              tabIndex={0}
              onClick={r.onSelect}
              onKeyDown={(e) => {
                if (r.onSelect && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  r.onSelect();
                }
              }}
              className={`group grid min-h-11 items-center gap-x-4 border-b border-stone-200 px-4 py-1 outline-none last:border-b-0 hover:bg-stone-50 focus-visible:bg-stone-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-coral dark:border-dashed ${
                r.onSelect ? "cursor-pointer" : ""
              } ${r.tone === "needs" ? "shadow-[inset_3px_0_0_var(--color-coral)]" : ""}`}
              style={style}
            >
              {data.cols.map((c) => (
                <div key={c.key} role="cell" className={`min-w-0 text-micro text-ink ${c.end ? "k-nums text-right" : ""}`}>
                  {r.cells[c.key]}
                </div>
              ))}
              {hasActs ? (
                <div role="cell" className="flex items-center justify-end gap-1">
                  {r.acts}
                  {r.door ? <span className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">{r.door}</span> : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      {data.foot ? <p className="shrink-0 border-t border-stone-200 px-4 py-2 text-micro text-steel dark:border-dashed">{data.foot}</p> : null}
    </>
  );
}

/* ── list (and the bare round-1 looks) ─────────────────────────────────────── */

function ListRows({ rows, limit }: { rows: PanelRow[]; limit?: number }) {
  // When some rows carry a mark and some do not, the unmarked ones keep the slot, so the
  // lines stay on one left edge.
  const anyMark = rows.some((r) => r.mark);
  return (
    <ul className="flex flex-col">
      {(limit ? rows.slice(0, limit) : rows).map((r) => (
        <li
          key={r.key}
          className={`flex flex-col gap-1 border-b border-stone-200 px-3 py-2 last:border-b-0 dark:border-dashed ${r.tone === "needs" ? "shadow-[inset_3px_0_0_var(--color-coral)]" : ""}`}
          data-row
        >
          <div
            className={`flex items-start gap-2 ${r.onSelect ? "cursor-pointer" : ""}`}
            onClick={r.onSelect}
            role={r.onSelect ? "button" : undefined}
            tabIndex={r.onSelect ? 0 : undefined}
            onKeyDown={
              r.onSelect
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      r.onSelect?.();
                    }
                  }
                : undefined
            }
          >
            {r.mark ? (
              <span className="mt-0.5 shrink-0">
                <Mark kind={r.mark} />
              </span>
            ) : anyMark ? (
              <span className="size-4 shrink-0" aria-hidden />
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-micro font-semibold leading-5 text-ink">{r.line}</span>
              {r.meta ? <span className="truncate text-micro leading-5 text-steel">{r.meta}</span> : null}
            </div>
            {r.trail != null ? <span className="k-nums shrink-0 text-micro leading-5 text-ink">{r.trail}</span> : null}
          </div>
          {r.acts ? <div className="flex flex-wrap items-center gap-1 pl-6">{r.acts}</div> : null}
        </li>
      ))}
    </ul>
  );
}

function ListBody({ data }: { data: PanelData }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {data.note ? <div className="px-3 pt-3">{data.note}</div> : null}
      <ListRows rows={data.rows} />
      {data.foot ? <p className="px-3 py-2 text-micro text-steel">{data.foot}</p> : null}
    </div>
  );
}

/* ── summary ───────────────────────────────────────────────────────────────── */

function SummaryBody({ data, onExpand, consoleLink }: { data: PanelData; onExpand?: () => void; consoleLink: ReactNode }) {
  const t = useTranslations("one.core.panels");
  const hidden = Math.max(0, data.rows.length - SUMMARY_ROWS);
  return (
    <div className="flex flex-col gap-1">
      {data.note ? <div className="px-3 pt-3">{data.note}</div> : null}
      {data.headline ? (
        <div className="flex items-baseline gap-2 px-4 pt-3" data-role="one-headline">
          <span className="k-nums font-serif text-display leading-none text-ink">{data.headline.figure}</span>
          {data.headline.label ? <span className="text-micro text-steel">{data.headline.label}</span> : null}
        </div>
      ) : null}
      <ListRows rows={data.rows} limit={SUMMARY_ROWS} />
      <div className="flex items-center gap-2 border-t border-stone-200 px-3 py-2 dark:border-dashed">
        {onExpand ? <Button label={hidden > 0 ? t("seeAllCount", { count: data.rows.length }) : t("seeAll")} variant="secondary" size="sm" onClick={onExpand} /> : consoleLink}
      </div>
    </div>
  );
}
