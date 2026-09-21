"use client";

// VARIANT 1 — "Ladder": one dense ranked table on the shared table kit.
//
// The densest of the three: every candidate the ranking admitted, plus the ones it
// filtered out, in ONE ordered list you can sort, filter and page — the shape a
// recruiter comparing forty people reaches for. It is the only variant that lets
// the reader re-order the pool (by name or by score), and the only one where the
// KO-filtered rows sit in the same table as the rest, wearing their reason, so a
// pool is read as one population rather than as a list plus an appendix.
//
// The whole ROW is the door; the name cell is a real <button> so the door is also
// reachable by keyboard, and its click does not have to bubble twice.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ColumnFilter } from "@/app/_components/table/ColumnFilter";
import { ColumnHead } from "@/app/_components/table/ColumnHead";
import { TablePager, clampPage, pageSlice } from "@/app/_components/table/TablePager";
import { TableStatus } from "@/app/_components/table/TableStatus";
import { useTableSort } from "@/app/_components/table/useTableSort";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { CHIP_QUIET } from "@/app/_components/ui/recipes";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { filterRows, stageOptions, type LadderRow, type VariantProps } from "./candidatesModel";

type Col = "rank" | "name" | "score";

export function CandidatesLadder({ rows, notEligible, opening, onOpen }: VariantProps) {
  const t = useTranslations("jobs.candidates");
  const enumLabel = useEnumLabel();
  const [name, setName] = useState("");
  const [stage, setStage] = useState("");
  const [page, setPage] = useState(0);

  // The KO cohort rides in the same table, after the ranked pool — it is the same
  // population and hiding it in a footnote is how "12 not eligible" became a number
  // nobody could act on.
  const all = [...rows, ...notEligible];
  const matched = filterRows(all, { name, stage });
  const { sorted, sort, toggle } = useTableSort<LadderRow, Col>(
    matched,
    { rank: (r) => (r.eligible ? r.rank : null), name: (r) => r.label, score: (r) => r.score },
    { col: "rank", dir: "asc" },
  );
  const safePage = clampPage(page, sorted.length);
  const shown = pageSlice(sorted, safePage);
  const titles: Record<Col, string> = { rank: t("colRank"), name: t("colCandidate"), score: t("colScore") };
  const filtered = name.trim() !== "" || stage !== "";

  return (
    <div>
      <TableStatus columnTitle={titles[sort.col]} dir={sort.dir} matched={sorted.length} filtered={filtered} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <ColumnHead<Col> title={titles.rank} sortCol="rank" sort={sort} onSort={toggle} align="right" className="w-12" />
              <ColumnHead<Col> title={titles.name} sortCol="name" sort={sort} onSort={toggle}>
                <ColumnFilter title={titles.name} value={name} onChange={(v) => { setName(v); setPage(0); }} mode="search" trigger="icon" />
              </ColumnHead>
              <ColumnHead<Col> title={titles.score} sortCol="score" sort={sort} onSort={toggle} align="right" className="w-20" />
              <ColumnHead<Col> title={t("colEvidence")} sort={sort} onSort={toggle} className="hidden md:table-cell" />
              <ColumnHead<Col> title={t("colStage")} sort={sort} onSort={toggle} className="w-36">
                <ColumnFilter
                  title={t("colStage")}
                  value={stage}
                  onChange={(v) => { setStage(v); setPage(0); }}
                  options={stageOptions(all).map((s) => ({ value: s, label: enumLabel("stage", s) }))}
                  trigger="icon"
                />
              </ColumnHead>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.id}
                onClick={() => onOpen(r.c)}
                aria-busy={opening === r.id}
                className={`cursor-pointer border-t border-stone-100 transition-colors hover:bg-paper ${
                  r.eligible ? "" : "opacity-70"
                }`}
              >
                <td className="nums py-1.5 pr-3 text-right text-steel">{r.eligible ? r.rank : "—"}</td>
                <td className="py-1.5 pr-3">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onOpen(r.c); }}
                    className="focus-ring cursor-pointer rounded text-left font-medium text-ink hover:text-coral"
                  >
                    {r.label}
                  </button>
                  {/* The early-career cohort lost its own column when the two
                      columns went; the shielding it carries is a fairness fact,
                      so the row says which candidates it applies to. */}
                  {r.early ? (
                    <span className="ml-1.5 rounded-full bg-green-50 px-1.5 py-0.5 text-meta text-green-700">
                      {t("earlyCareerChip")}
                    </span>
                  ) : null}
                  {r.nearMiss ? (
                    <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-meta text-amber-800">
                      {t("nearMiss")}
                    </span>
                  ) : null}
                  {!r.eligible && r.koReasons.length > 0 ? (
                    <span className="ml-1.5 text-sm text-amber-700">{r.koReasons.join("; ")}</span>
                  ) : null}
                </td>
                <td className="py-1.5 pr-3 text-right"><ScoreBadge score={r.score} /></td>
                <td className="hidden py-1.5 pr-3 md:table-cell">
                  <span className="flex flex-wrap gap-1">
                    {r.strengths.map((s) => (
                      <span key={s} className="rounded bg-green-50 px-1.5 py-0.5 text-meta text-green-700">{s}</span>
                    ))}
                    {r.gaps.map((s) => (
                      <span key={`x-${s}`} className="rounded bg-red-50 px-1.5 py-0.5 text-meta text-red-700">{s}</span>
                    ))}
                  </span>
                </td>
                <td className="py-1.5">
                  {r.stage ? (
                    <span className={CHIP_QUIET}>{enumLabel("stage", r.stage)}</span>
                  ) : (
                    <span className="text-sm text-steel">{t("notFiled")}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length === 0 ? <p className="py-3 text-sm text-steel">{t("noneMatch")}</p> : null}
      <div className="mt-2">
        <TablePager page={safePage} total={sorted.length} onPage={setPage} />
      </div>
    </div>
  );
}
