"use client";

// VARIANT C — "Scoreboard". Metaphor: a league table.
//
// The baseline and the deck both take the WORKSPACE as the unit: one funnel, one
// forecast, one set of numbers, with roles demoted to a capped table at the
// bottom. But hiring work is done per role — the question a recruiter actually
// arrives with is "which of my roles is stuck", and an aggregate funnel averages
// exactly that away (two healthy roles and one dead one read as "fine").
//
// So here the ROW is the role, and everything else is supporting evidence:
//   • every column sorts (the shared useTableSort/ColumnHead — a ranking you
//     can't re-rank is just a list), and the table filters and pages;
//   • each row carries its own micro-funnel, so shape is comparable at a glance;
//   • the workspace aggregate is one summary row above the table, not the page;
//   • the funnel and forecast become compact supporting cards below.
//
// KNOWN LIMIT of this direction, and the thing to decide before it could ship:
// /api/analytics returns `byJob` already capped to the highest-VOLUME roles
// (byJobTotal says how many exist). A league table that ranks by hire rate over
// a volume-capped set can hide its own leader — a small role with a great rate
// that missed the volume cut simply is not in the ranking. The cap is stated in
// the header, but for a design whose premise IS the ranking, "stated" is weaker
// than "correct": committing to this variant means ranking server-side, or
// returning every role.
import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { forecastHires } from "@/app/_lib/analytics-forecast";
import { downloadFile, toCsv } from "@/app/_lib/export-utils";
import { PANEL } from "@/app/_components/ui/recipes";
import { Defer } from "@/app/_components/ui/Defer";
import { ColumnFilter } from "@/app/_components/table/ColumnFilter";
import { ColumnHead } from "@/app/_components/table/ColumnHead";
import { clampPage, pageSlice, TablePager } from "@/app/_components/table/TablePager";
import { useTableSort } from "@/app/_components/table/useTableSort";
import { AnalyticsEmptyPreview } from "../AnalyticsEmptyPreview";
import { GoalsEditor } from "../AnalyticsGoalsEditor";
import { MomentumPanel, OrgBenchmarkPanel } from "./sectionChunks";
import { ScoreboardSummary, RoleFunnelBar } from "./ScoreboardParts";
import type { PerformanceProps } from "./performanceTypes";

type RoleRow = PerformanceProps["data"]["byJob"][number];
type Col = "jobTitle" | "koDeclined" | "total" | "reachedInterview" | "hired" | "hireRatePct";

export function PerformanceScoreboard({ data, boardHref, reload }: PerformanceProps) {
  const t = useTranslations("analytics");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const forecast = forecastHires({
    weeklyAdded: data.momentum.map((w) => w.added),
    funnel: data.funnel.map((r) => ({ stage: r.stage, reached: r.reached, current: r.current })),
    avgTimeToHireDays: data.avgTimeToHireDays,
    offerAcceptRate: data.offers.acceptRate,
  });

  // Rank by hire rate out of the box: the scoreboard's premise is that some
  // roles are winning and some aren't, so it has to open already ranked.
  const { sorted, sort, toggle } = useTableSort<RoleRow, Col>(
    data.byJob,
    {
      jobTitle: (r) => r.jobTitle,
      koDeclined: (r) => r.koDeclined,
      total: (r) => r.total,
      reachedInterview: (r) => r.reachedInterview,
      hired: (r) => r.hired,
      // A role with nobody in pipeline has no rate to rank — null, so it sits
      // out of the ranking rather than posing as a 0% performer.
      hireRatePct: (r) => (r.total === 0 ? null : r.hireRatePct),
    },
    { col: "hireRatePct", dir: "desc" }
  );

  const filtered = query.trim() ? sorted.filter((r) => r.jobTitle.toLowerCase().includes(query.trim().toLowerCase())) : sorted;
  const safePage = clampPage(page, filtered.length);
  const shown = pageSlice(filtered, safePage);
  const peak = Math.max(1, ...data.byJob.map((r) => r.total));

  // First run: no candidate has ever existed, so the ranking has nothing to rank.
  // Reuses the tab's single first-run hero rather than inventing a second empty
  // state — and it stays the hero here, since the scoreboard IS the section.
  if (data.total === 0) {
    return (
      <div className={`${PANEL} p-5`}>
        <AnalyticsEmptyPreview
          title={t("noPipelineEntries")}
          body={t("noPipelineEntriesBody")}
          links={[
            { tab: "jobs", label: t("emptyCtaJobs") },
            { tab: "channels", label: t("emptyCtaChannels") },
          ]}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ScoreboardSummary data={data} forecast={forecast} />

      <div className={`${PANEL} p-5`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-serif text-h2 text-ink">{t("byRole")}</h3>
          <div className="flex items-baseline gap-3">
            {data.byJobTotal > data.byJob.length ? (
              <p className="text-meta uppercase text-steel">{t("topByVolume", { shown: data.byJob.length, total: data.byJobTotal })}</p>
            ) : null}
            <button
              type="button"
              onClick={() =>
                downloadFile(
                  "kp-roles.csv",
                  toCsv([
                    [t("colJob"), t("colKoDeclined"), t("colInPipeline"), t("colReachedInterview"), t("colHired"), t("colHireRate")],
                    // Export what is ON SCREEN — the reader's sort and filter are
                    // part of what they asked for; re-exporting the raw payload
                    // silently hands back a different table than the one shown.
                    ...filtered.map((j) => [j.jobTitle, j.koDeclined, j.total, j.reachedInterview, j.hired, `${j.hireRatePct}%`]),
                  ]),
                  "text/csv"
                )
              }
              disabled={filtered.length === 0}
              className="focus-ring inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white px-2.5 py-1 text-sm font-medium text-steel hover:bg-paper hover:text-ink disabled:opacity-50 print:hidden"
            >
              <Download size={12} aria-hidden /> {t("exportCsv")}
            </button>
          </div>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[48rem] text-base">
            <thead>
              <tr className="border-b border-stone-200">
                <ColumnHead title={t("colJob")} sortCol="jobTitle" sort={sort} onSort={toggle}>
                  <ColumnFilter
                    title={t("colJob")}
                    mode="search"
                    trigger="icon"
                    value={query}
                    onChange={(q) => {
                      setQuery(q);
                      setPage(0);
                    }}
                  />
                </ColumnHead>
                {/* The shape column is a visual, not a value — nothing to order by. */}
                <ColumnHead title={t("scoreboardShape")} sort={sort} onSort={toggle} className="w-40" />
                <ColumnHead title={t("colInPipeline")} sortCol="total" sort={sort} onSort={toggle} align="right" />
                <ColumnHead title={t("colReachedInterview")} sortCol="reachedInterview" sort={sort} onSort={toggle} align="right" />
                <ColumnHead title={t("colHired")} sortCol="hired" sort={sort} onSort={toggle} align="right" />
                <ColumnHead title={t("colHireRate")} sortCol="hireRatePct" sort={sort} onSort={toggle} align="right" />
                <ColumnHead title={t("colKoDeclined")} sortCol="koDeclined" sort={sort} onSort={toggle} align="right" />
              </tr>
            </thead>
            <tbody>
              {shown.map((j) => (
                <tr key={j.jobTitle} className="border-b border-stone-100 last:border-0 hover:bg-paper/50">
                  <td className="py-2 pr-3">
                    <Link
                      href={boardHref({ q: j.jobTitle })}
                      title={t("viewInBoard")}
                      className="focus-ring rounded font-medium text-ink underline-offset-2 hover:text-coral hover:underline"
                    >
                      {j.jobTitle}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">
                    <RoleFunnelBar row={j} peak={peak} />
                  </td>
                  <td className="py-2 pr-3 text-right text-ink nums">{j.total}</td>
                  <td className="py-2 pr-3 text-right text-steel nums">{j.reachedInterview}</td>
                  <td className="py-2 pr-3 text-right font-semibold text-ink nums">{j.hired}</td>
                  <td className="py-2 pr-3 text-right nums">
                    {j.total === 0 ? (
                      <span className="text-steel">—</span>
                    ) : (
                      <span className={j.hired > 0 ? "font-semibold text-moss" : "text-steel"}>{j.hireRatePct}%</span>
                    )}
                  </td>
                  <td className="py-2 text-right text-steel nums">{j.koDeclined}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 ? (
          <p className="py-6 text-center text-base text-steel">{t("scoreboardNoMatches")}</p>
        ) : (
          <div className="mt-3">
            <TablePager page={safePage} total={filtered.length} onPage={setPage} />
          </div>
        )}
      </div>

      {/* Supporting evidence, deliberately secondary to the table. */}
      <Defer strategy="next-frame">
        <MomentumPanel weeks={data.momentum} />
      </Defer>
      <Defer strategy="idle">
        <OrgBenchmarkPanel />
      </Defer>
      {/* The goal lines the rate column colours against stay editable from here. */}
      <Defer strategy="visible">
        <ScoreboardGoals data={data} reload={reload} />
      </Defer>
    </div>
  );
}

/** The goals editor, kept in its own card so the table above stays the subject. */
function ScoreboardGoals({ data, reload }: { data: PerformanceProps["data"]; reload: () => void }) {
  const t = useTranslations("analytics");
  return (
    <div className={`${PANEL} p-5`}>
      <h3 className="font-serif text-h2 text-ink">{t("scoreboardGoals")}</h3>
      <GoalsEditor
        stages={data.funnel.map((f) => f.stage)}
        conversion={data.targets.conversion}
        timeToHireDays={data.targets.timeToHireDays}
        onSaved={reload}
      />
    </div>
  );
}
