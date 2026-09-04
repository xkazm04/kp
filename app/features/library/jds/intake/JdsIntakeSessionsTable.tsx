"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import { ColumnFilter, type Option } from "@/app/_components/table/ColumnFilter";
import { ColumnHead } from "@/app/_components/table/ColumnHead";
import { clampPage, pageSlice, TablePager } from "@/app/_components/table/TablePager";
import { useTableSort, type SortAccessors } from "@/app/_components/table/useTableSort";
import { CHIP_QUIET, META_LABEL } from "@/app/_components/ui/recipes";
import { shortDate } from "../jdsLibrary";
import type { IntakeShape, IntakeSummary } from "./jdsIntakeLogic";

// The intake ledger's session list. It used to be a stack of full-width buttons —
// one card per session, unfiltered, unsorted, unpaged — which reads fine at a
// demo's half-dozen and not at all at the 19 a working library already holds: no
// way to find the one conversation you half-remember, no way to see which are
// still open, and a scroll with no end.
//
// It is now the SAME table register every other ledger in the studio uses
// (ProfileRoster, the Channels comms ledger, the Assignments outbox): the shared
// kit's sortable `ColumnHead` (which owns `aria-sort`), spreadsheet-style
// `ColumnFilter` triggers living IN the headers rather than in a toolbar above
// them, and the shared 20-row `TablePager` — so nothing here re-derives paging
// arithmetic or a comparator, and a reader who has used one ledger has used this
// one.

const SHAPE_KEY = {
  power_unit: "shape.powerUnit",
  story: "shape.story",
  app_master: "shape.appMaster",
} as const;

const STATUSES = ["open", "complete", "promoted"] as const;

type SortCol = "title" | "turns" | "updated";

export function JdsIntakeSessionsTable({ sessions, onOpen }: { sessions: IntakeSummary[]; onOpen: (id: string) => void }) {
  const t = useTranslations("library.tab.intake");
  const locale = useLocale();
  const [q, setQ] = useState("");
  const [shape, setShape] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);

  // Facets list the shapes/statuses actually PRESENT, so the menus can never
  // offer a filter that yields nothing.
  const shapeOptions = useMemo<Option[]>(
    () =>
      (Object.keys(SHAPE_KEY) as (keyof typeof SHAPE_KEY)[])
        .filter((k) => sessions.some((s) => s.shape === k))
        .map((k) => ({ value: k, label: t(SHAPE_KEY[k]) })),
    [sessions, t]
  );
  const statusOptions = useMemo<Option[]>(
    () =>
      STATUSES.filter((s) => sessions.some((row) => row.status === s)).map((s) => ({
        value: s,
        label: t(`status.${s}`),
      })),
    [sessions, t]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return sessions.filter(
      (s) =>
        (!needle || (s.title || "").toLowerCase().includes(needle)) &&
        (!shape || s.shape === shape) &&
        (!status || s.status === status)
    );
  }, [sessions, q, shape, status]);

  // `updatedAt` is nullish on a session nothing has touched since it was created;
  // the accessor falls back to `createdAt` rather than handing the comparator a
  // null, which would sort every untouched session to the bottom in BOTH
  // directions (compareCells' missing-value rule) — correct for an unknown, wrong
  // for a date we hold.
  const accessors = useMemo<SortAccessors<IntakeSummary, SortCol>>(
    () => ({
      title: (s) => s.title || "",
      turns: (s) => s.turnCount,
      updated: (s) => s.updatedAt ?? s.createdAt,
    }),
    []
  );
  const { sorted, sort, toggle } = useTableSort<IntakeSummary, SortCol>(filtered, accessors, { col: "updated", dir: "desc" });
  // Clamped, not reset: filtering to fewer pages under a reader sitting on the
  // last one must land them on a page that exists.
  const safePage = clampPage(page, sorted.length);
  const shown = pageSlice(sorted, safePage);
  const filterOn = Boolean(q.trim() || shape || status);
  // Any filter change re-cuts the set, so it returns to page 1 — staying on page
  // 3 of a list that just became a different list is disorienting.
  const onFilter = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(0);
  };

  return (
    <div className="mt-4 space-y-3">
      <div className="overflow-x-auto rounded-lg border border-stone-200">
        <table className="w-full min-w-[36rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-stone-200 bg-paper/60">
              <ColumnHead title={t("table.role")} sortCol="title" sort={sort} onSort={toggle} className="px-3 py-2">
                <ColumnFilter title={t("table.role")} mode="search" trigger="icon" value={q} onChange={onFilter(setQ)} />
              </ColumnHead>
              {/* Shape and status are categories, not rankings: they filter, they
                  do not sort (the roster's Status column set the precedent). */}
              <ColumnHead title={t("table.shape")} sort={sort} onSort={toggle} className="px-3 py-2">
                <ColumnFilter title={t("table.shape")} trigger="icon" value={shape} onChange={onFilter(setShape)} options={shapeOptions} />
              </ColumnHead>
              <ColumnHead title={t("table.status")} sort={sort} onSort={toggle} className="px-3 py-2">
                <ColumnFilter title={t("table.status")} trigger="icon" value={status} onChange={onFilter(setStatus)} options={statusOptions} />
              </ColumnHead>
              <ColumnHead title={t("table.turns")} sortCol="turns" sort={sort} onSort={toggle} align="right" className="px-3 py-2" />
              <ColumnHead title={t("table.updated")} sortCol="updated" sort={sort} onSort={toggle} className="hidden px-3 py-2 sm:table-cell" />
              <th scope="col" className={`px-3 py-2 text-right ${META_LABEL}`}>
                <span className="sr-only">{t("table.open")}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200">
            {shown.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center">
                  <p className="text-body text-steel">{filterOn ? t("table.noMatch") : t("empty")}</p>
                  {filterOn ? (
                    <button
                      type="button"
                      onClick={() => {
                        setQ("");
                        setShape("");
                        setStatus("");
                        setPage(0);
                      }}
                      className="focus-ring mt-2 rounded-full border border-stone-300 bg-white px-3 py-1 text-sm font-semibold text-ink hover:border-coral/40"
                    >
                      {t("table.clear")}
                    </button>
                  ) : null}
                </td>
              </tr>
            ) : (
              shown.map((s) => (
                <tr
                  key={s.id}
                  tabIndex={0}
                  role="button"
                  aria-label={t("table.openSession", { title: s.title || t("untitled") })}
                  onClick={() => onOpen(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen(s.id);
                    }
                  }}
                  className="focus-ring cursor-pointer transition-colors hover:bg-paper"
                >
                  <td className="px-3 py-2.5 text-body font-medium text-ink">{s.title || t("untitled")}</td>
                  <td className="px-3 py-2.5">
                    {s.shape ? <span className={CHIP_QUIET}>{t(SHAPE_KEY[s.shape as NonNullable<IntakeShape>])}</span> : <span className="text-steel">—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={CHIP_QUIET}>{t(`status.${s.status}`)}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-meta text-steel nums">{s.turnCount}</td>
                  <td className="hidden whitespace-nowrap px-3 py-2.5 text-meta text-steel sm:table-cell">
                    {shortDate(s.updatedAt ?? s.createdAt, locale)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-steel">
                    <ChevronRight size={15} aria-hidden />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <TablePager page={safePage} total={sorted.length} onPage={setPage} />
    </div>
  );
}
