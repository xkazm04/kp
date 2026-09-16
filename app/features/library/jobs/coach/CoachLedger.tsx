"use client";

import { useState } from "react";
import { SquarePen } from "lucide-react";
import { useTranslations } from "next-intl";
import { ColumnHead } from "@/app/_components/table/ColumnHead";
import { TablePager, clampPage, pageSlice, TABLE_PAGE_SIZE } from "@/app/_components/table/TablePager";
import { TableStatus } from "@/app/_components/table/TableStatus";
import { useTableSort } from "@/app/_components/table/useTableSort";
import { PRIORITY_WEIGHT, type PriorityLevel } from "@/app/_lib/role-priorities";
import { CoachPriorityDial } from "./CoachPriorityDial";
import { sharePercent, usePatternCopy } from "./coachLabels";
import type { RolePattern, RolePriorityMap, Winnability } from "./rolePatterns";

// The ledger of patterns — the winner of the 2026-09 prototype round, fused: the
// Ledger's one-row-per-pattern table as the baseline, simplified to a single line
// (headline with its measure inline · share bar · dial · one action), with the Dial
// variant's three-notch priority control in place of the chip row.

const ICON_BTN =
  "focus-ring inline-grid h-8 w-8 cursor-pointer place-items-center rounded-md text-steel transition-colors hover:bg-paper hover:text-coral";

type Col = "pattern" | "share" | "priority";

export function CoachLedger({
  patterns,
  priorities,
  win,
  onPriority,
  onEdit,
}: {
  patterns: RolePattern[];
  priorities: RolePriorityMap;
  win: Winnability | null;
  onPriority: (patternId: string, level: PriorityLevel | null) => void;
  onEdit: ((pattern: RolePattern) => void) | null;
}) {
  const t = useTranslations("jobs.coach");
  const copyOf = usePatternCopy(win);
  const [page, setPage] = useState(0);

  const { sorted, sort, toggle } = useTableSort<RolePattern, Col>(
    patterns,
    {
      pattern: (p) => p.value,
      share: (p) => p.share ?? -1,
      // Untagged sorts BELOW every weighted row rather than above `minor`: the
      // question this column answers is "what have I weighed", not "what is light".
      priority: (p) => (priorities[p.id] ? PRIORITY_WEIGHT[priorities[p.id]] : -1),
    },
    { col: "share", dir: "desc" },
  );

  const safePage = clampPage(page, sorted.length);
  const rows = pageSlice(sorted, safePage);
  const titles: Record<Col, string> = { pattern: t("col.pattern"), share: t("col.share"), priority: t("col.priority") };

  return (
    <div className="space-y-3">
      <TableStatus columnTitle={titles[sort.col]} dir={sort.dir} matched={sorted.length} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-base">
          <thead>
            <tr className="border-b border-stone-200">
              <ColumnHead<Col> title={titles.pattern} sortCol="pattern" sort={sort} onSort={toggle} className="pl-1" />
              <ColumnHead<Col> title={titles.share} sortCol="share" sort={sort} onSort={toggle} className="w-40" />
              <ColumnHead<Col> title={titles.priority} sortCol="priority" sort={sort} onSort={toggle} className="w-28" />
              <ColumnHead<Col> title={t("col.action")} sort={sort} onSort={toggle} align="right" className="w-12" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const copy = copyOf(p);
              const pct = sharePercent(p);
              return (
                <tr key={p.id} className="border-b border-stone-200/70">
                  <td className="py-2 pl-1 pr-3 align-middle">
                    <span className="text-ink">{copy.title}</span>
                    {copy.measure ? <span className="ml-2 text-sm text-steel nums">{copy.measure}</span> : null}
                  </td>
                  <td className="py-2 pr-3 align-middle">
                    {pct === null ? (
                      // A dash, never a zero bar: "not countable" and "costs nobody"
                      // are different answers and the ledger must not conflate them.
                      <span className="text-sm text-steel" title={t("noShare")}>
                        {"—"}
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100" role="img" aria-label={t("shareAria", { pct })}>
                          <span className="block h-full rounded-full bg-coral" style={{ width: `${Math.max(pct, 2)}%` }} />
                        </span>
                        <span className="w-9 shrink-0 text-right text-sm text-steel nums">{t("pct", { pct })}</span>
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 align-middle">
                    <CoachPriorityDial patternId={p.id} patternLabel={copy.title} level={priorities[p.id] ?? null} onChange={onPriority} />
                  </td>
                  <td className="py-2 pr-1 text-right align-middle">
                    {onEdit && p.editable ? (
                      <button type="button" onClick={() => onEdit(p)} aria-label={t("stageEditAria", { value: p.value })} title={t("stageEdit")} className={ICON_BTN}>
                        <SquarePen size={15} aria-hidden />
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <TablePager page={safePage} total={sorted.length} onPage={setPage} pageSize={TABLE_PAGE_SIZE} />
    </div>
  );
}
