"use client";

// The ONE surface every /one panel renders in, whatever its data (docs/design/one-interface.md
// "Panel looks"). A panel component reads its data and hands this frame a `PanelData`
// (columns + rows + an insight reading); the frame draws it three ways:
//
//   table    fills its container. One surface: head, sticky column head, dense rows on one
//            CSS grid template (row height = `--one-row-h`), the body scrolls inside. Rows
//            take keyboard focus (↑ ↓ move, Enter selects, a row's own letter keys arm its
//            acts — `a` advance, `r` reject — named in a key hint at the foot). A row's acts
//            are QUIET: shown on the first row, on hover, focus and the selected row only.
//   insight  the answer's card (round 3, "insight, not rows"): the SHAPE of the answer — a
//            stacked part bar, a spread that grows into the height it is given, a few facts
//            and at most one suggested act. It never repeats the table's count. The answer
//            card is the screen's one sticker (`data-one-sticker`, finish.css).
//   list     a dense single column for a narrow side: a line + a meta line per item.
//   pane     round 4: a TOOL filling its container (profile, letter, calendar). The panel
//            hands its own body for it (`body.pane`); without one the table is drawn.
//
// Round 4 also: pipeline rows are GROUPED BY ROLE in the table and list looks (a sticky
// group head: role, count, stalled count; groups sit where their first row was, rows keep
// the view's order inside), and rows that carry an `entry` are SELECTABLE — a press or
// Enter picks the candidate in the session (`onSelectEntry`), Esc on a row clears it, and
// the picked row is marked. Group heads are not focus stops; ↑ ↓ cross groups.
//
// A panel is one surface: the frame paints the border, the host's className only places and
// sizes it. Corner, outline width and padding follow the finish hooks (finish.css). Loading
// is a quiet LoadingGap, error is a critical Note with a retry whose text is resolved from
// the read's CODE (useErrorMessage) — the server's English `error` never renders.
import Link from "next/link";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Button, Mark, Note, type MarkKind } from "@/app/_components/kit";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { CHIP_QUIET, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import type { ScoreTone } from "@/app/_lib/format";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { WorkspaceTabId } from "@/app/features/shell/tabs";
import { useOneMotion } from "../motion";
import { consoleHref } from "./PanelShell";
import type { Selected } from "../types";
import type { Read } from "./read";
import type { PanelLook, PanelProps } from "./types";

/** One table column: `track` is its CSS grid track ("minmax(0,1fr)", "6rem"). */
export type Col = { key: string; label: string; track: string; end?: boolean };

export type PanelRow = {
  key: string;
  /** Table cells by column key. */
  cells: Record<string, ReactNode>;
  /** List: the one-line primary text, and the line under it. */
  line: ReactNode;
  meta?: ReactNode;
  /** List: the figure at the line's right edge. */
  trail?: ReactNode;
  /** The row's own acts (Advance / Reject) — quiet in the table (first row, hover, focus,
   *  selection), always drawn in the list. */
  acts?: ReactNode;
  /** The row's own keys while it has focus (`a` → advance): they arm the same acts. */
  keys?: Record<string, () => void>;
  /** The row's Console door — drawn on hover / focus in the table, left out of the list. */
  door?: ReactNode;
  mark?: MarkKind;
  tone?: "needs" | "caution";
  onSelect?: () => void;
  /** Round 4: the candidate this row is (rows with one are selectable when the host passes
   *  `onSelectEntry`; the picked one is marked). */
  entry?: Selected;
  /** Round 4: the role group this row belongs to (role grouping), and whether it is stalled
   *  (the group head counts those). */
  group?: { key: string; label: string };
  stalled?: boolean;
};

/** One part of a stacked bar / one bin of a spread. */
export type InsightPart = { key: string; label: string; value: number };

/** The `insight` look's reading — computed by the panel from the data it already read
 *  (panels/insight.ts holds the arithmetic). Every part is optional; an insight with
 *  nothing to say says `quiet`. */
export type InsightData = {
  /** Where the rows stand: a stacked bar with a legend (≤ 5 parts, largest first). */
  shape?: { label: string; parts: InsightPart[] };
  /** A spread (score bins, horizons, funnel steps) as columns that grow with the card. */
  spread?: { label: string; bins: (InsightPart & { tone?: ScoreTone })[]; note?: string };
  /** A few facts: the oldest waiter, the top role, the next interview… */
  facts?: { key: string; label: string; value: ReactNode; sub?: ReactNode; mark?: MarkKind }[];
  /** At most ONE suggested next act — it arms a proposal; nothing runs from here. */
  suggest?: { label: string; hint: string; onPress: () => void };
  quiet?: string;
};

export type PanelData = {
  title: string;
  /** A numeral beside the TABLE's title; absent = not shown (never a 0 the read did not return). */
  count?: number | string | null;
  state?: string;
  console?: { tab: WorkspaceTabId; params?: Record<string, string>; label?: string };
  read: Read<unknown> & { retry: () => void };
  cols: Col[];
  /** The width of the acts + door column ("0" = none). Fixed, so every row aligns. */
  actsTrack?: string;
  rows: PanelRow[];
  /** The `insight` look's reading. */
  insight?: InsightData;
  /** The table foot's key hint, when rows carry keys ("↑↓ move · A advance · R reject"). */
  keyHint?: string;
  /** A stated empty state, shown when the read is ready and there are no rows. */
  empty?: string;
  /** Above the rows (a relay-off warning). */
  note?: ReactNode;
  /** Under the rows ("Showing the first 8 of 12."). */
  foot?: string;
  /** Round 4: a panel's own body for a look (the tools' `pane`, the calendar's week grid).
   *  The frame still draws the head and the loading / error states; `rows` may be empty. */
  body?: Partial<Record<PanelLook, ReactNode>>;
};

/** The finish-hooked title: one face (`--one-title-font`, the body face by default), h3, semibold. */
export const PANEL_TITLE = "min-w-0 truncate font-[family-name:var(--one-title-font)] text-h3 font-semibold text-ink";

/** The primary table cell: name over subline, an optional lead mark. The NAME never
 *  truncates (it wraps); the subline does, and its `trail` (an age) stays whole. */
export function NameCell({ name, sub, trail, mark }: { name: ReactNode; sub?: ReactNode; trail?: ReactNode; mark?: MarkKind }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {mark ? <Mark kind={mark} /> : null}
      <span className="flex min-w-0 flex-col">
        <span className="text-micro font-semibold leading-5 break-words text-ink">{name}</span>
        {sub || trail ? (
          <span className="flex min-w-0 items-center gap-1 text-micro leading-5 text-steel">
            {sub ? <span className="min-w-0 truncate">{sub}</span> : null}
            {trail ? <span className="inline-flex shrink-0 items-center gap-1">{trail}</span> : null}
          </span>
        ) : null}
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
  const { panel, look = "list", className = "", chrome, onExpand } = props;
  const { read } = data;
  const insight = look === "insight";
  const surface = insight ? `${PANEL} flex flex-col` : `${PANEL} flex min-h-0 flex-col overflow-hidden`;
  const own = data.body?.[look];
  const rows = withSelection(data.rows, props);
  const grouped = props.group !== "none";
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
    if (own) return own;
    if (data.rows.length === 0) {
      return (
        <>
          {data.note}
          <p className="px-[var(--one-pad)] py-6 text-body text-steel" data-role="one-empty">
            {data.empty ?? t("notReturned")}
          </p>
        </>
      );
    }
    if (look === "table" || look === "pane") return <TableBody data={{ ...data, rows }} grouped={grouped} props={props} />;
    if (insight) return <InsightBody data={data} />;
    return <ListBody data={{ ...data, rows }} grouped={grouped} selectedEntryId={props.selectedEntryId ?? null} />;
  };

  return (
    <section
      className={`${surface} ${className}`}
      data-one-panel={panel.kind}
      data-panel-id={panel.id}
      data-look={look}
      data-one-surface
      data-one-sticker={insight || undefined}
      // An insight with a spread has something to grow into; a host may let only such a card
      // take spare height (a card of facts alone would only grow white space).
      data-grows={(insight && ready && data.rows.length > 0 && data.insight?.spread != null) || undefined}
      data-pinned={panel.pinned ? "true" : undefined}
      aria-label={data.title}
    >
      <div className={`flex shrink-0 items-center gap-3 border-b border-stone-200 dark:border-b-2 ${look === "list" ? "min-h-11 px-3 py-1" : "min-h-12 px-[var(--one-pad)] py-1.5"}`}>
        <h3 className={PANEL_TITLE} data-role="one-panel-title">
          {data.title}
        </h3>
        {!insight && ready && data.count != null ? (
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
          {insight && onExpand ? <Button label={t("seeAll")} variant="link" size="sm" onClick={onExpand} /> : look === "table" || look === "pane" || insight ? consoleLink : null}
          {insight ? null : chrome}
        </div>
      </div>
      {body()}
      {look === "list" && ready && consoleLink ? <div className="flex shrink-0 border-t border-stone-200 px-2 py-1 dark:border-dashed">{consoleLink}</div> : null}
    </section>
  );
}

/* ── selection + role groups ───────────────────────────────────────────────── */

/** Rows that name a candidate become selectable when the host lets them: a press or Enter
 *  picks the candidate (a row's own onSelect, if it has one, still wins). */
function withSelection(rows: PanelRow[], props: PanelProps): PanelRow[] {
  const pick = props.onSelectEntry;
  if (!pick) return rows;
  return rows.map((r) => (r.entry && !r.onSelect ? { ...r, onSelect: () => pick(r.entry ?? null) } : r));
}

type RowGroup = { key: string; label: string; rows: PanelRow[]; stalled: number };

/** The rows grouped by role, in first-row order — or null when there is nothing to group
 *  (grouping off, a row without a group, or one group only: a lone head says nothing). */
export function roleGroups(rows: readonly PanelRow[], grouped: boolean): RowGroup[] | null {
  if (!grouped || rows.length === 0 || rows.some((r) => !r.group)) return null;
  const out: RowGroup[] = [];
  const at = new Map<string, RowGroup>();
  for (const r of rows) {
    const g = r.group as { key: string; label: string };
    let hit = at.get(g.key);
    if (!hit) {
      hit = { key: g.key, label: g.label, rows: [], stalled: 0 };
      at.set(g.key, hit);
      out.push(hit);
    }
    hit.rows.push(r);
    if (r.stalled) hit.stalled += 1;
  }
  return out.length > 1 ? out : null;
}

/** A role group's head: the role, its count, and its stalled count when there are any. Not a
 *  focus stop (the rowgroup carries the name for assistive tech). */
function GroupHead({ group, sticky }: { group: RowGroup; sticky: boolean }) {
  const t = useTranslations("one.core.panels.group");
  return (
    <div
      className={`flex min-h-8 items-center gap-2 border-b border-stone-200 bg-stone-50 px-[var(--one-pad)] py-1 dark:border-dashed ${sticky ? "sticky top-[var(--one-colhead-h)] z-[5]" : ""}`}
      data-role="one-group-head"
      aria-hidden
    >
      <span className="min-w-0 truncate text-micro font-semibold text-ink">{group.label}</span>
      <span className="k-nums shrink-0 text-micro text-steel">{group.rows.length}</span>
      {group.stalled > 0 ? (
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-micro text-steel">
          <Mark kind="caution" />
          {t("stalled", { count: group.stalled })}
        </span>
      ) : null}
    </div>
  );
}

/* ── table ─────────────────────────────────────────────────────────────────── */

/** A row's quiet acts: hidden until the row is hovered, focused or selected — the first
 *  row always shows them, so the affordance is never a secret. */
const QUIET_ACTS = "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 group-data-[selected]:opacity-100 group-data-[picked]:opacity-100";

/** Under a role group's head a row's role subline (marked `data-role-sub`) repeats the head,
 *  so a grouped table hides it (the age stays). */
const GROUPED_SUB = "[&_[data-role-sub]]:hidden [&_.truncate:has(>[data-role-sub])]:hidden";

function TableBody({ data, grouped, props }: { data: PanelData; grouped: boolean; props: PanelProps }) {
  const t = useTranslations("one.core.panels");
  const m = useOneMotion();
  const [selected, setSelected] = useState<string | null>(null);
  const template = [...data.cols.map((c) => c.track), ...(data.actsTrack && data.actsTrack !== "0" ? [data.actsTrack] : [])].join(" ");
  const style: CSSProperties = { gridTemplateColumns: template };
  const hasActs = data.actsTrack != null && data.actsTrack !== "0";
  const groups = roleGroups(data.rows, grouped);
  // Display order: grouped (groups in first-row order), else the view's own.
  const ordered = groups ? groups.flatMap((g) => g.rows) : data.rows;
  const firstKey = ordered[0]?.key;

  const onKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!target.matches("[data-row]")) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // Every row in document order — group heads are not rows, so ↑ ↓ cross groups.
      const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-row]"));
      const next = rows[rows.indexOf(target) + (e.key === "ArrowDown" ? 1 : -1)];
      if (!next) return;
      e.preventDefault();
      next.focus();
      return;
    }
    if (e.key === "Escape" && props.selectedEntryId && props.onSelectEntry) {
      e.preventDefault();
      props.onSelectEntry(null);
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const row = data.rows.find((r) => r.key === target.dataset.rowKey);
    const act = row?.keys?.[e.key.toLowerCase()];
    if (act) {
      e.preventDefault();
      act();
    }
  };

  const rowOf = (r: PanelRow) => {
    const i = ordered.indexOf(r);
    const enter = m.rowStagger(i);
    const first = r.key === firstKey;
    const picked = r.entry != null && r.entry.entryId === props.selectedEntryId;
    return (
      <motion.div
        key={r.key}
        {...(enter ?? {})}
        role="row"
        data-row
        data-row-key={r.key}
        data-selected={selected === r.key || undefined}
        data-picked={picked || undefined}
        aria-selected={r.entry && props.onSelectEntry ? picked : undefined}
        tabIndex={0}
        onFocus={(e) => {
          if (e.target === e.currentTarget) setSelected(r.key);
        }}
        onClick={r.onSelect}
        onKeyDown={(e) => {
          if (r.onSelect && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            r.onSelect();
          }
        }}
        className={`group grid min-h-[var(--one-row-h)] items-center gap-x-4 border-b border-stone-200 px-[var(--one-pad)] py-1 outline-none last:border-b-0 hover:bg-stone-50 focus-visible:bg-stone-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-coral data-[selected]:bg-stone-50 data-[picked]:bg-stone-100 dark:border-dashed ${
          r.onSelect ? "cursor-pointer" : ""
        } ${picked ? "shadow-[inset_3px_0_0_var(--color-ink)]" : r.tone === "needs" ? "shadow-[inset_3px_0_0_var(--color-coral)]" : ""}`}
        style={style}
      >
        {data.cols.map((c) => (
          <div key={c.key} role="cell" className={`min-w-0 text-micro text-ink ${c.end ? "k-nums text-right" : ""}`}>
            {r.cells[c.key]}
          </div>
        ))}
        {hasActs ? (
          <div role="cell" className={`flex items-center justify-end gap-0.5 ${first ? "" : QUIET_ACTS}`} data-role="one-row-acts">
            {r.acts}
            {r.door ? <span className={first && !r.acts ? QUIET_ACTS : ""}>{r.door}</span> : null}
          </div>
        ) : null}
      </motion.div>
    );
  };

  return (
    <>
      {data.note ? <div className="shrink-0 px-3 pt-3">{data.note}</div> : null}
      <div className={`min-h-0 flex-1 overflow-auto ${groups ? GROUPED_SUB : ""}`} role="table" aria-label={data.title} onKeyDown={onKeys} data-role="one-table" data-grouped={groups ? "role" : undefined}>
        <div className="min-w-[32rem]">
          <div role="row" className="sticky top-0 z-10 grid h-[var(--one-colhead-h)] items-center gap-x-4 border-b border-stone-200 bg-white px-[var(--one-pad)] dark:border-b-2" style={style}>
            {data.cols.map((c) => (
              <div key={c.key} role="columnheader" className={`${META_LABEL} truncate ${c.end ? "text-right" : ""}`}>
                {c.label}
              </div>
            ))}
            {hasActs ? <div role="presentation" /> : null}
          </div>
          {groups
            ? groups.map((g) => (
                // A rowgroup per role: its head sticks under the column head while the group
                // is in view, and the next group's head pushes it out.
                <div key={g.key} role="rowgroup" aria-label={g.label} data-role="one-group">
                  <GroupHead group={g} sticky />
                  {g.rows.map(rowOf)}
                </div>
              ))
            : data.rows.map(rowOf)}
        </div>
      </div>
      {data.foot || data.keyHint ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-stone-200 px-[var(--one-pad)] py-2 text-micro text-steel dark:border-dashed" data-role="one-table-foot">
          <span>{data.foot ?? ""}</span>
          {data.keyHint ? (
            <span className="k-nums" data-role="one-key-hint">
              <span className="sr-only">{t("keysLabel")}: </span>
              {data.keyHint}
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/* ── list ──────────────────────────────────────────────────────────────────── */

function ListRows({ rows, grouped, selectedEntryId }: { rows: PanelRow[]; grouped: boolean; selectedEntryId: string | null }) {
  const groups = roleGroups(rows, grouped);
  if (groups) {
    return (
      <div className="flex flex-col">
        {groups.map((g) => (
          <div key={g.key} role="group" aria-label={g.label} data-role="one-group">
            <GroupHead group={g} sticky={false} />
            <ListRows rows={g.rows} grouped={false} selectedEntryId={selectedEntryId} />
          </div>
        ))}
      </div>
    );
  }
  // When some rows carry a mark and some do not, the unmarked ones keep the slot, so the
  // lines stay on one left edge.
  const anyMark = rows.some((r) => r.mark);
  return (
    <ul className="flex flex-col">
      {rows.map((r) => {
        const picked = r.entry != null && r.entry.entryId === selectedEntryId;
        return (
          <li
            key={r.key}
            className={`flex flex-col gap-1 border-b border-stone-200 px-3 py-2 last:border-b-0 data-[picked]:bg-stone-100 dark:border-dashed ${
              picked ? "shadow-[inset_3px_0_0_var(--color-ink)]" : r.tone === "needs" ? "shadow-[inset_3px_0_0_var(--color-coral)]" : ""
            }`}
            data-row
            data-picked={picked || undefined}
          >
            <div
              className={`flex items-start gap-2 ${r.onSelect ? "cursor-pointer" : ""}`}
              onClick={r.onSelect}
              role={r.onSelect ? "button" : undefined}
              aria-pressed={r.onSelect && r.entry ? picked : undefined}
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
                <span className="break-words text-micro font-semibold leading-5 text-ink">{r.line}</span>
                {r.meta ? <span className="truncate text-micro leading-5 text-steel">{r.meta}</span> : null}
              </div>
              {r.trail != null ? <span className="k-nums shrink-0 text-micro leading-5 text-ink">{r.trail}</span> : null}
            </div>
            {r.acts ? <div className="flex flex-wrap items-center gap-1 pl-6">{r.acts}</div> : null}
          </li>
        );
      })}
    </ul>
  );
}

function ListBody({ data, grouped, selectedEntryId }: { data: PanelData; grouped: boolean; selectedEntryId: string | null }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {data.note ? <div className="px-3 pt-3">{data.note}</div> : null}
      <ListRows rows={data.rows} grouped={grouped} selectedEntryId={selectedEntryId} />
      {data.foot ? <p className="px-3 py-2 text-micro text-steel">{data.foot}</p> : null}
    </div>
  );
}

/* ── insight ───────────────────────────────────────────────────────────────── */

/** Stacked-bar fills, largest part first: a monochrome ramp (no hue claims a meaning here). */
const SHAPE_FILL = ["bg-ink", "bg-steel", "bg-stone-400", "bg-stone-300", "bg-stone-200"] as const;
const SPREAD_FILL: Record<ScoreTone, string> = {
  strong: "bg-score-strong",
  mid: "bg-score-mid",
  weak: "bg-score-weak",
  null: "bg-score-null",
};

export function InsightBody({ data }: { data: PanelData }) {
  const ins = data.insight;
  if (!ins) return null;
  const shapeTotal = ins.shape ? ins.shape.parts.reduce((n, p) => n + p.value, 0) : 0;
  const spreadMax = ins.spread ? Math.max(1, ...ins.spread.bins.map((b) => b.value)) : 1;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5 p-[var(--one-pad)]" data-role="one-insight">
      {data.note ? <div>{data.note}</div> : null}
      {ins.quiet ? <p className="text-body text-steel">{ins.quiet}</p> : null}

      {ins.shape && shapeTotal > 0 ? (
        <div className="flex shrink-0 flex-col gap-2" data-insight="shape">
          <p className={META_LABEL}>{ins.shape.label}</p>
          <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden>
            {ins.shape.parts.map((p, i) => (
              <span key={p.key} className={`h-full ${SHAPE_FILL[i] ?? SHAPE_FILL[4]} first:rounded-l-full last:rounded-r-full`} style={{ flexGrow: p.value, flexBasis: 0 }} />
            ))}
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-micro">
            {ins.shape.parts.map((p, i) => (
              <li key={p.key} className="flex min-w-0 items-center gap-1.5">
                <span className={`size-2.5 shrink-0 rounded-full ${SHAPE_FILL[i] ?? SHAPE_FILL[4]}`} aria-hidden />
                <span className="truncate text-steel">{p.label}</span>
                <span className="k-nums font-semibold text-ink">{p.value}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {ins.spread ? (
        // The spread takes the card's spare height. It is a size container: given room it is
        // a column chart (count over bar over label); squeezed (a consent card open) it
        // folds into a one-line strip, so it never draws clipped labels.
        <div className="flex min-h-20 flex-1 flex-col gap-2" data-insight="spread">
          <div className="flex items-baseline justify-between gap-3">
            <p className={META_LABEL}>{ins.spread.label}</p>
            {ins.spread.note ? <p className="truncate text-micro text-steel">{ins.spread.note}</p> : null}
          </div>
          <div className="min-h-0 flex-1 [container-type:size]">
            <ul
              className="grid h-full items-end gap-2 [@container(max-height:6rem)]:hidden"
              style={{ gridTemplateColumns: `repeat(${ins.spread.bins.length}, minmax(0,1fr))` }}
            >
              {ins.spread.bins.map((b) => (
                <li key={b.key} className="flex h-full min-h-0 flex-col items-stretch justify-end gap-1" aria-label={`${b.label}: ${b.value}`}>
                  <span className="k-nums text-center text-micro font-semibold text-ink">{b.value}</span>
                  <span className="flex min-h-0 flex-1 flex-col justify-end">
                    <span
                      className={`block w-full rounded-t-sm ${b.value === 0 ? "bg-stone-200" : SPREAD_FILL[b.tone ?? "null"]}`}
                      style={{ height: b.value === 0 ? "2px" : `${Math.max(6, Math.round((b.value / spreadMax) * 100))}%` }}
                    />
                  </span>
                  <span className="truncate border-t border-stone-200 pt-1 text-center text-micro text-steel">{b.label}</span>
                </li>
              ))}
            </ul>
            <ul className="hidden h-full flex-wrap content-center gap-x-3 gap-y-1 text-micro [@container(max-height:6rem)]:flex" aria-hidden>
              {ins.spread.bins.map((b) => (
                <li key={b.key} className="flex items-center gap-1.5">
                  <span className={`h-2.5 w-1.5 shrink-0 rounded-full ${b.value === 0 ? "bg-stone-200" : SPREAD_FILL[b.tone ?? "null"]}`} />
                  <span className="text-steel">{b.label}</span>
                  <span className="k-nums font-semibold text-ink">{b.value}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {ins.facts && ins.facts.length > 0 ? (
        <dl className="grid shrink-0 grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-x-6 gap-y-3" data-insight="facts">
          {ins.facts.map((f) => (
            <div key={f.key} className="flex min-w-0 flex-col gap-0.5">
              <dt className={META_LABEL}>{f.label}</dt>
              <dd className="flex min-w-0 items-center gap-1.5 text-micro font-semibold text-ink">
                {f.mark ? <Mark kind={f.mark} /> : null}
                <span className="min-w-0 truncate">{f.value}</span>
              </dd>
              {f.sub ? <dd className="truncate text-micro text-steel">{f.sub}</dd> : null}
            </div>
          ))}
        </dl>
      ) : null}

      {ins.suggest ? (
        <div className="flex shrink-0 items-center gap-3 border-t border-stone-200 pt-3 dark:border-dashed" data-insight="suggest">
          <Button label={ins.suggest.label} variant="secondary" size="sm" className="shrink-0" onClick={ins.suggest.onPress} data-role="one-suggest" />
          <span className="min-w-0 truncate text-micro text-steel" data-tip={ins.suggest.hint}>
            {ins.suggest.hint}
          </span>
        </div>
      ) : null}
    </div>
  );
}
