"use client";

// The decisions LEDGER — one row per AI recommendation waiting on a human, in place
// of the card grid. The winner of the 2026-09 prototype round: rows grouped BY ROLE
// under a sticky header (how many wait there, the best fit), fused with the
// quick-decide mechanism — the Decision column carries three icon doors: accept ✓,
// reject ✕, and the candidate modal for a considered call.
//
// Columns: candidate · role · pipeline (the board stage chip) · score (the ONE
// canonical fit number) · what the AI proposes · decision. Rows read one model
// (decisionsLedgerModel.ts), share their cells (LedgerCells.tsx) and take the table
// kit's grammar — sortable heads, per-column filters, twenty rows to a page — with
// the grouped ordering in decisionsLedgerTable.ts (groups stay whole under any sort).

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { clampPage, pageSlice, TablePager } from "@/app/_components/table/TablePager";
import { TableStatus } from "@/app/_components/table/TableStatus";
import { useTableSort } from "@/app/_components/table/useTableSort";
import { PANEL } from "@/app/_components/ui/recipes";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { Entry } from "@/app/features/shared/decisionsTypes";
import { ledgerRowOf, type LedgerRow } from "./decisionsLedgerModel";
import { EMPTY_FILTERS, filterLedgerRows, groupKeepingOrder, groupPage, isFiltering, proposalKey, type LedgerFilters } from "./decisionsLedgerTable";
import { CELL, DecisionCell, LedgerHead, PipelineCell, ProposalCell, ScoreCell, SelectCell, type LedgerCol } from "./LedgerCells";

export function DecisionsLedger({
  entries,
  staleSinceOf,
  selectMode,
  selectedIds,
  onToggleSelect,
  leavingWrapClass,
  onDecide,
  act,
}: {
  entries: Entry[];
  staleSinceOf: (e: Entry) => string | null;
  selectMode: boolean;
  selectedIds: ReadonlySet<string>;
  onToggleSelect: (e: Entry) => void;
  leavingWrapClass: (e: Entry) => string;
  /** The considered door: the candidate modal with the decision attached. */
  onDecide: (e: Entry) => void;
  /** The quick doors: apply the proposal from the row. */
  act: (e: Entry, action: "accept" | "reject") => void;
}) {
  const t = useTranslations("decisions.ledger");
  const enumLabel = useEnumLabel();
  const rows = useMemo(() => entries.map((e) => ledgerRowOf(e, staleSinceOf(e))), [entries, staleSinceOf]);
  const [filters, setFilters] = useState<LedgerFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const setFilter = (key: keyof LedgerFilters) => (value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(0);
  };
  const filtered = useMemo(() => filterLedgerRows(rows, filters), [rows, filters]);
  const { sorted, sort, toggle } = useTableSort<LedgerRow, LedgerCol>(
    filtered,
    {
      name: (r) => r.entry.candidateLabel,
      role: (r) => r.entry.jobTitle,
      pipeline: (r) => enumLabel("stage", r.entry.stage),
      score: (r) => r.score,
      recommended: (r) => (r.offer ? r.offer.amount : (r.recommendation ?? "")),
    },
    { col: "role", dir: "asc" },
  );
  const onSort = (col: LedgerCol) => {
    toggle(col);
    setPage(0);
  };
  const { flat } = useMemo(() => groupKeepingOrder(sorted), [sorted]);
  const safePage = clampPage(page, flat.length);
  const groups = useMemo(() => groupPage(pageSlice(flat, safePage)), [flat, safePage]);
  const span = 6 + (selectMode ? 1 : 0);
  const titles: Record<LedgerCol, string> = {
    name: t("colName"),
    role: t("colRole"),
    pipeline: t("colPipeline"),
    score: t("colScore"),
    recommended: t("colRecommended"),
  };
  const options = {
    role: [...new Map(rows.map((r) => [r.entry.jobId ?? r.entry.jobTitle ?? "?", r.entry.jobTitle ?? ""])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label })),
    stage: [...new Set(rows.map((r) => r.entry.stage))].map((s) => ({ value: s, label: enumLabel("stage", s) })),
    recommended: [...new Set(rows.map(proposalKey))]
      .filter(Boolean)
      .map((v) => ({ value: v, label: v === "offer" ? t("proposalOffer") : enumLabel("recommendation", v) })),
  };

  return (
    <div className="mt-3 space-y-2">
      <TableStatus columnTitle={titles[sort.col]} dir={sort.dir} matched={filtered.length} filtered={isFiltering(filters)} />
      <div className={`${PANEL} overflow-x-auto`}>
        <table className="w-full border-collapse text-sm">
          <LedgerHead withSelect={selectMode} titles={titles} sort={sort} onSort={onSort} filters={filters} setFilter={setFilter} options={options} />
          {groups.map((g) => (
            <tbody key={g.key}>
              <tr className="border-t border-stone-200 bg-stone-50">
                <th scope="rowgroup" colSpan={span} className={`${CELL} sticky top-0 text-left`}>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-serif text-base text-ink">{g.title}</span>
                    <span className="text-sm text-steel">{t("groupCount", { count: g.rows.length })}</span>
                    {g.best != null ? (
                      <span className="flex items-center gap-1 text-sm text-steel">
                        {t("groupBest")} <ScoreBadge score={g.best} />
                      </span>
                    ) : null}
                  </span>
                </th>
              </tr>
              {g.rows.map((row) => {
                const { entry } = row;
                return (
                  <tr key={entry.id} data-sim-entry={entry.id} className={`border-t border-stone-200 hover:bg-stone-50 ${leavingWrapClass(entry)}`}>
                    {selectMode ? (
                      <td className={CELL}>
                        <SelectCell row={row} selected={selectedIds.has(entry.id)} onToggle={row.eligible ? () => onToggleSelect(entry) : undefined} />
                      </td>
                    ) : null}
                    <td className={`${CELL} font-semibold text-ink`}>{entry.candidateLabel}</td>
                    <td className={`${CELL} text-steel`}>{entry.jobTitle}</td>
                    <td className={CELL}><PipelineCell stage={entry.stage} /></td>
                    <td className={CELL}><ScoreCell score={row.score} /></td>
                    <td className={CELL}><ProposalCell row={row} /></td>
                    <td className={`${CELL} text-right`}>
                      <DecisionCell row={row} hidden={selectMode} onAccept={() => act(entry, "accept")} onReject={() => act(entry, "reject")} onDecide={() => onDecide(entry)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
        <div className="border-t border-stone-200 px-3 py-2">
          <TablePager page={safePage} total={flat.length} onPage={setPage} />
        </div>
      </div>
    </div>
  );
}
