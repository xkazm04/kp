"use client";

import { useState } from "react";
import { SquarePen } from "lucide-react";
import { useTranslations } from "next-intl";
import { ColumnHead } from "@/app/_components/table/ColumnHead";
import { TablePager, clampPage, pageSlice, TABLE_PAGE_SIZE } from "@/app/_components/table/TablePager";
import { TableStatus } from "@/app/_components/table/TableStatus";
import { useTableSort } from "@/app/_components/table/useTableSort";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { PRIORITY_WEIGHT, type PriorityLevel } from "@/app/_lib/role-priorities";
import { CoachPriorityChips } from "./CoachPriorityChips";
import { sharePercent, usePatternCopy } from "./coachLabels";
import type { RolePattern, RolePriorityMap, Winnability } from "./rolePatterns";

// VARIANT 1 — "Ledger". The dense, auditable reading: every pattern on one row, sorted
// by whichever column the recruiter is arguing from, weighed in place. It is the
// variant for someone who already knows the role and wants the whole picture at once.

type Col = "pattern" | "share" | "affected" | "priority";

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
      affected: (p) => p.affected,
      // Untagged sorts BELOW every weighted row rather than above `minor`: the
      // question this column answers is "what have I weighed", not "what is light".
      priority: (p) => (priorities[p.id] ? PRIORITY_WEIGHT[priorities[p.id]] : -1),
    },
    { col: "affected", dir: "desc" },
  );

  const safePage = clampPage(page, sorted.length);
  const rows = pageSlice(sorted, safePage);
  const titles: Record<Col, string> = {
    pattern: t("col.pattern"),
    share: t("col.share"),
    affected: t("col.affected"),
    priority: t("col.priority"),
  };

  return (
    <div className="space-y-3">
      <TableStatus columnTitle={titles[sort.col]} dir={sort.dir} matched={sorted.length} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-base">
          <thead>
            <tr className="border-b border-stone-200">
              <ColumnHead<Col> title={titles.pattern} sortCol="pattern" sort={sort} onSort={toggle} className="pl-1" />
              <ColumnHead<Col> title={titles.share} sortCol="share" sort={sort} onSort={toggle} className="w-36" />
              <ColumnHead<Col> title={titles.affected} sortCol="affected" sort={sort} onSort={toggle} align="right" className="w-20" />
              <ColumnHead<Col> title={titles.priority} sortCol="priority" sort={sort} onSort={toggle} className="w-56" />
              <ColumnHead<Col> title={t("col.action")} sort={sort} onSort={toggle} align="right" className="w-28" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const copy = copyOf(p);
              const pct = sharePercent(p);
              return (
                <tr key={p.id} className="border-b border-stone-200/70 align-top">
                  <td className="py-2.5 pl-1 pr-3">
                    <p className="text-ink">{copy.title}</p>
                    {copy.measure ? <p className="text-sm text-steel nums">{copy.measure}</p> : null}
                  </td>
                  <td className="py-2.5 pr-3">
                    {pct === null ? (
                      // A dash, never a zero bar: "not countable" and "costs nobody"
                      // are different answers and the ledger must not conflate them.
                      <span className="text-sm text-steel" title={t("noShare")}>
                        {"—"}
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span
                          className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100"
                          role="img"
                          aria-label={t("shareAria", { pct })}
                        >
                          <span className="block h-full rounded-full bg-coral" style={{ width: `${Math.max(pct, 2)}%` }} />
                        </span>
                        <span className="w-9 shrink-0 text-right text-sm text-steel nums">{t("pct", { pct })}</span>
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-right text-ink nums">{copy.measure ? p.affected : "—"}</td>
                  <td className="py-2.5 pr-3">
                    <CoachPriorityChips
                      patternId={p.id}
                      patternLabel={copy.title}
                      level={priorities[p.id] ?? null}
                      onChange={onPriority}
                    />
                  </td>
                  <td className="py-2.5 pr-1 text-right">
                    {onEdit && p.editable ? (
                      <button
                        type="button"
                        onClick={() => onEdit(p)}
                        aria-label={t("stageEditAria", { value: p.value })}
                        className="focus-ring inline-flex cursor-pointer items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-sm font-semibold text-steel transition-colors hover:border-coral/40 hover:text-coral"
                      >
                        <SquarePen size={13} aria-hidden /> {t("stageEdit")}
                      </button>
                    ) : (
                      <span className={META_LABEL}>{"—"}</span>
                    )}
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
