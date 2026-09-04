"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { downloadFile, toCsv } from "@/app/_lib/export-utils";
import { ColumnFilter } from "@/app/_components/table/ColumnFilter";
import { AnalyticsEmptyPreview } from "./AnalyticsEmptyPreview";
import { hasRoleRows } from "./performanceBands";
import type { Analytics } from "./AnalyticsTypes";
import { META_LABEL, PANEL } from "@/app/_components/ui/recipes";

// The by-role table — the tab's single first-run empty-state hero
// (AnalyticsEmptyPreview) lives here. Split out of AnalyticsTab.tsx to keep
// that file under the 200-line cap.
//
// UAT TOM-ANA-6 — the table is server-capped to the highest-volume roles
// (`BY_JOB_CAP = 12`, `db/analytics.ts`) and was sorted by volume with no way to
// look anything up. The reader most likely to need it is the manager of ONE open
// seat with a handful of applicants — precisely the row that ranks last and drops
// off first. Two things follow: the column header is a search box, and the cap
// says out loud how many roles it left out plus where to reach them. The search
// is honest about its own reach: it filters the loaded rows, and when it finds
// nothing it says so and hands the query to the board rather than implying the
// role does not exist.
export function AnalyticsByRoleTable({ data, boardHref }: { data: Analytics; boardHref: (filter: { q?: string; stage?: string }) => string }) {
  const t = useTranslations("analytics");
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const rows = needle ? data.byJob.filter((j) => j.jobTitle.toLocaleLowerCase().includes(needle)) : data.byJob;
  // Rows the server ranked away. `byJobTotal` counts every distinct role with
  // activity in the window, so this is the honest count of what is not here.
  const hidden = Math.max(0, data.byJobTotal - data.byJob.length);
  return (
    <div className={`${PANEL} p-5`}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-serif text-h2 text-ink">{t("byRole")}</h3>
        <div className="flex items-baseline gap-3">
          {/* The table is capped to the highest-volume roles; say so explicitly when
              there are more, so it never reads as the complete list of open roles.
              With a search active the count reports the filter instead, so the
              header never disagrees with the rows underneath it. */}
          {needle ? (
            <p className={META_LABEL}>{t("byRoleFilterCount", { shown: rows.length, total: data.byJob.length })}</p>
          ) : hidden > 0 ? (
            <p className={META_LABEL}>{t("topByVolume", { shown: data.byJob.length, total: data.byJobTotal })}</p>
          ) : null}
          {/* ANA5: the role funnel as a file — what a hiring manager asks for.
              Exports exactly the rows on screen: a file that quietly disagreed
              with the visible filter would be the same defect one layer down. */}
          <button
            type="button"
            onClick={() =>
              downloadFile(
                "kp-roles.csv",
                toCsv([
                  [t("colJob"), t("colKoDeclined"), t("colInPipeline"), t("colReachedInterview"), t("colHired"), t("colHireRate")],
                  // The dash travels with the row: a file that printed "0%" where the
                  // screen shows "—" would re-introduce the fabricated zero one layer down.
                  ...rows.map((j) => [j.jobTitle, j.koDeclined, j.total, j.reachedInterview, j.hired, j.total === 0 ? "—" : `${j.hireRatePct}%`]),
                ]),
                "text/csv"
              )
            }
            disabled={rows.length === 0}
            className="focus-ring inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white px-2.5 py-1 text-sm font-medium text-steel hover:bg-paper hover:text-ink disabled:opacity-50 print:hidden"
          >
            <Download size={12} aria-hidden /> {t("exportCsv")}
          </button>
        </div>
      </div>
      <table aria-label={t("byRole")} className="mt-3 w-full text-base">
        <thead>
          <tr className={`border-b border-stone-200 text-left ${META_LABEL}`}>
            {/* The header IS the search box — the repo's ColumnFilter idiom
                (comms ledger, tasks, outbox, roster), not a new one. */}
            <th scope="col" className="pb-2 font-semibold">
              <ColumnFilter title={t("colJob")} mode="search" value={query} onChange={setQuery} />
            </th>
            <th scope="col" className="pb-2 text-right font-semibold">{t("colKoDeclined")}</th>
            <th scope="col" className="pb-2 text-right font-semibold">{t("colInPipeline")}</th>
            <th scope="col" className="pb-2 text-right font-semibold">{t("colReachedInterview")}</th>
            <th scope="col" className="pb-2 text-right font-semibold">{t("colHired")}</th>
            <th scope="col" className="pb-2 text-right font-semibold">{t("colHireRate")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((j) => (
            <tr key={j.jobTitle} className="border-b border-stone-100 last:border-0">
              {/* The title cell links (a tr can't be a Link): the board's free-text
                  filter matches on jobTitle, so ?q=<title> isolates this role. */}
              <td className="py-2 pr-2 text-ink">
                <Link
                  href={boardHref({ q: j.jobTitle })}
                  title={t("viewInBoard")}
                  className="focus-ring rounded underline-offset-2 hover:text-coral hover:underline"
                >
                  {j.jobTitle}
                </Link>
              </td>
              <td className={`py-2 text-right ${j.koDeclined > 0 ? "text-coral" : "text-steel"}`}>{j.koDeclined}</td>
              <td className="py-2 text-right text-steel">{j.total}</td>
              <td className="py-2 text-right text-steel">{j.reachedInterview}</td>
              <td className="py-2 text-right text-ink">{j.hired}</td>
              {/* A role with KO discards but NO pipeline entry still gets a row
                  (db/analytics.ts seeds jobMap from koByJob), and the server sends
                  `hireRatePct: 0` for it — an undefined ratio, not a measured one.
                  Rendered flat it read as a confident green "0%" for a role nobody
                  ever entered. Same two-part guard the sibling table already uses
                  (EconomicsBoard: "a surface with nobody in it has no rate"): no
                  cohort → a dash; a real cohort with no hire yet → the number, but
                  not in the colour that means "this converts". */}
              <td className="py-2 text-right">
                {j.total === 0 ? (
                  <span className="text-steel">—</span>
                ) : (
                  <span className={j.hired > 0 ? "font-medium text-moss" : "text-steel"}>{j.hireRatePct}%</span>
                )}
              </td>
            </tr>
          ))}
          {/* UAT TOM-ANA-12 — the same predicate the Briefing's "which roles carry
              it" band reads for its heading, so the claim above this table and the
              hero inside it are decided once. */}
          {!hasRoleRows(data.byJob) ? (
            <tr>
              <td colSpan={6} className="py-3">
                {/* THE first-run empty state of this tab: no pipeline entry has
                    ever existed, so every figure above is blank too. The readout
                    previews the metrics this tab will hand back — honest em-dashes,
                    never fabricated figures. */}
                <AnalyticsEmptyPreview
                  title={t("noPipelineEntries")}
                  body={t("noPipelineEntriesBody")}
                  links={[
                    { tab: "jobs", label: t("emptyCtaJobs") },
                    { tab: "channels", label: t("emptyCtaChannels") },
                  ]}
                />
              </td>
            </tr>
          ) : rows.length === 0 ? (
            // A search that matched none of the LOADED rows. It may still be a real
            // role sitting below the cap, so this must not read as "no such role" —
            // it reports the reach of the search and hands the query to the board.
            <tr>
              <td colSpan={6} className="py-3 text-base text-steel">
                {t.rich("byRoleNoMatch", {
                  q: query.trim(),
                  link: (chunks) => (
                    <Link
                      href={boardHref({ q: query.trim() })}
                      className="focus-ring rounded font-semibold text-coral underline-offset-2 hover:underline"
                    >
                      {chunks}
                    </Link>
                  ),
                })}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      {/* The cap, stated rather than implied. The eyebrow above says "top 12 of
          34"; this says what the other 22 are and where to reach them, because a
          reader who cannot see their own role needs an exit, not a ratio. */}
      {hidden > 0 ? (
        <p className="mt-3 text-sm text-steel">
          {t.rich("byRoleCapNote", {
            hidden,
            shown: data.byJob.length,
            link: (chunks) => (
              <Link
                href={boardHref({ q: query.trim() || undefined })}
                className="focus-ring rounded font-semibold text-coral underline-offset-2 hover:underline"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      ) : null}
    </div>
  );
}
