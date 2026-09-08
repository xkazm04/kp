"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import { ColumnFilter, type Option } from "@/app/_components/table/ColumnFilter";
import { ColumnHead } from "@/app/_components/table/ColumnHead";
import { clampPage, pageSlice, TablePager } from "@/app/_components/table/TablePager";
import { useTableSort, type SortAccessors } from "@/app/_components/table/useTableSort";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { shortDate } from "../../jdsLibrary";
import type { IntakeSummary } from "../jdsIntakeLogic";
import { LedgerGhost, ShapeMark, StatusMark, TurnTicks } from "./LedgerMarks";
import { LEDGER_SPRING, LEDGER_STAGGER_CAP, LEDGER_STAGGER_MS, LEDGER_STATUSES, SHAPE_KEY } from "./ledgerKit";

// THE RECORDS PLANE — the same data the shipped table holds, without the box.
//
// The shipped ledger draws a bordered card with a tinted header band and a
// rounded outline around six columns, which is a spreadsheet dropped onto a
// page. Here there is ONE surface: the heads are uppercase marks over a
// hairline, the records are separated by hairlines, and the only geometry that
// moves is the cursor behind the record the dossier is describing.
//
// Everything the shared table kit owns is kept, because it is behaviour and not
// decoration: `ColumnHead` (which owns `aria-sort`), the spreadsheet-style
// `ColumnFilter` triggers living IN the heads, the 20-row `TablePager`, and the
// `useTableSort` comparator with its `updatedAt ?? createdAt` accessor. The
// table ELEMENT is kept too — this is tabular data, and a grid of divs would owe
// every one of those semantics back by hand.
//
// Three facts are drawn rather than spelled (LedgerMarks.tsx): the shape is a
// gutter mark, the turn count is a run of ticks, the status is a terminal mark
// which, on a promoted run, is the door to the JD it produced.
//
// MOTION. Records arrive staggered — 40 ms apart, first twelve only, on the
// house spring — whenever the list they are cut from changes (a filter, a sort,
// a page). Nothing animates ambiently, and under reduced motion the stagger and
// the cursor's shared layout are dropped rather than run at zero duration.

type SortCol = "title" | "turns" | "updated";

export function LedgerRecords({
  sessions,
  highlightedId,
  onOpen,
}: {
  sessions: IntakeSummary[];
  /** The record the dossier is describing — the cursor's home. */
  highlightedId: string | null;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("library.tab.intake");
  const locale = useLocale();
  const reduced = useReducedMotion();
  const [q, setQ] = useState("");
  const [shape, setShape] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);

  // Facets list the shapes/statuses actually PRESENT, so a menu can never offer
  // a filter that yields nothing.
  const shapeOptions = useMemo<Option[]>(
    () =>
      (Object.keys(SHAPE_KEY) as (keyof typeof SHAPE_KEY)[])
        .filter((k) => sessions.some((s) => s.shape === k))
        .map((k) => ({ value: k, label: t(SHAPE_KEY[k]) })),
    [sessions, t]
  );
  const statusOptions = useMemo<Option[]>(
    () =>
      LEDGER_STATUSES.filter((s) => sessions.some((row) => row.status === s)).map((s) => ({
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

  // `updatedAt` is nullish on a session nothing has touched since it was
  // created; the accessor falls back to `createdAt` rather than handing the
  // comparator a null (which would sink every untouched session in BOTH
  // directions).
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
  const onFilter = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(0);
  };
  // The cut this body was made from. When it changes the records are a new list
  // and they land again; while it holds, a re-render (a hover, an open) animates
  // nothing.
  const cut = `${q}|${shape}|${status}|${sort.col}|${sort.dir}|${safePage}`;

  return (
    <div className="mt-4 space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse text-left">
          <caption className="sr-only">{t("ledger.recordsLabel")}</caption>
          <thead>
            <tr className="border-b border-stone-200">
              {/* The gutter head carries the shape filter and no word: the column
                  is one mark wide and its name lives on the control. */}
              <th scope="col" className="w-8 pb-2">
                <span className="sr-only">{t("table.shape")}</span>
                <ColumnFilter title={t("table.shape")} trigger="icon" value={shape} onChange={onFilter(setShape)} options={shapeOptions} />
              </th>
              <ColumnHead title={t("table.role")} sortCol="title" sort={sort} onSort={toggle}>
                <ColumnFilter title={t("table.role")} mode="search" trigger="icon" value={q} onChange={onFilter(setQ)} />
              </ColumnHead>
              <ColumnHead title={t("table.turns")} sortCol="turns" sort={sort} onSort={toggle} className="w-40" />
              <ColumnHead title={t("table.updated")} sortCol="updated" sort={sort} onSort={toggle} className="hidden sm:table-cell" />
              <th scope="col" className={`w-10 pb-2 text-right ${META_LABEL}`}>
                <span className="sr-only">{t("table.status")}</span>
                <ColumnFilter title={t("table.status")} trigger="icon" value={status} onChange={onFilter(setStatus)} options={statusOptions} />
              </th>
            </tr>
          </thead>
          {/* Keyed on the cut: a new list is a new tbody, so the arrival plays
              once per list rather than on every render. */}
          <tbody key={cut} className="divide-y divide-stone-200">
            {shown.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-2">
                  {/* No sentence: the outline IS the statement that records will
                      land here. A filtered-to-nothing plane still owes the reader
                      the way back, and that is a control, not prose. */}
                  <LedgerGhost rows={3} />
                  {filterOn ? (
                    <button
                      type="button"
                      onClick={() => {
                        setQ("");
                        setShape("");
                        setStatus("");
                        setPage(0);
                      }}
                      className="focus-ring rounded-full border border-stone-300 px-3 py-1 text-sm font-semibold text-ink transition-colors hover:border-coral/40"
                    >
                      {t("table.clear")}
                    </button>
                  ) : null}
                </td>
              </tr>
            ) : (
              shown.map((s, i) => {
                const isHighlighted = s.id === highlightedId;
                return (
                  <motion.tr
                    key={s.id}
                    initial={reduced ? false : { opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={
                      reduced
                        ? { duration: 0 }
                        : { ...LEDGER_SPRING, delay: i < LEDGER_STAGGER_CAP ? (i * LEDGER_STAGGER_MS) / 1000 : 0 }
                    }
                    tabIndex={0}
                    role="button"
                    aria-label={t("table.openSession", { title: s.title || t("untitled") })}
                    aria-current={isHighlighted ? "true" : undefined}
                    onClick={() => onOpen(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpen(s.id);
                      }
                    }}
                    className="focus-ring group/record cursor-pointer transition-colors hover:bg-paper"
                  >
                    <td className="relative py-2.5 pr-2">
                      {/* The reader's position, and the only geometry on this
                          plane that moves: one element sliding between records. */}
                      {isHighlighted ? (
                        <motion.span
                          layoutId={reduced ? undefined : "ledger-cursor"}
                          transition={LEDGER_SPRING}
                          className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-coral"
                          aria-hidden
                        />
                      ) : null}
                      <span className="flex justify-center">
                        <ShapeMark shape={s.shape} />
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-body font-medium text-ink">{s.title || t("untitled")}</td>
                    <td className="py-2.5 pr-3">
                      <TurnTicks turns={s.turnCount} />
                    </td>
                    <td className="hidden whitespace-nowrap py-2.5 pr-3 text-meta text-steel sm:table-cell">
                      {shortDate(s.updatedAt ?? s.createdAt, locale)}
                    </td>
                    <td className="py-2.5 text-right">
                      <span className="flex justify-end">
                        <StatusMark status={s.status} jdSlug={s.jdSlug} />
                      </span>
                    </td>
                  </motion.tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <TablePager page={safePage} total={sorted.length} onPage={setPage} />
    </div>
  );
}
