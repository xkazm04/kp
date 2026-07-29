"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { downloadFile, toCsv } from "@/app/_lib/export-utils";
import { AnalyticsEmptyPreview } from "./AnalyticsEmptyPreview";
import type { Analytics } from "./AnalyticsTypes";

// The by-role table — the tab's single first-run empty-state hero
// (AnalyticsEmptyPreview) lives here. Split out of AnalyticsTab.tsx to keep
// that file under the 200-line cap.
export function AnalyticsByRoleTable({ data, boardHref }: { data: Analytics; boardHref: (filter: { q?: string; stage?: string }) => string }) {
  const t = useTranslations("analytics");
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-serif text-h2 text-ink">{t("byRole")}</h3>
        <div className="flex items-baseline gap-3">
          {/* The table is capped to the highest-volume roles; say so explicitly when
              there are more, so it never reads as the complete list of open roles. */}
          {data.byJobTotal > data.byJob.length ? (
            <p className="text-meta uppercase text-steel">{t("topByVolume", { shown: data.byJob.length, total: data.byJobTotal })}</p>
          ) : null}
          {/* ANA5: the role funnel as a file — what a hiring manager asks for. */}
          <button
            type="button"
            onClick={() =>
              downloadFile(
                "kp-roles.csv",
                toCsv([
                  [t("colJob"), t("colKoDeclined"), t("colInPipeline"), t("colReachedInterview"), t("colHired"), t("colHireRate")],
                  ...data.byJob.map((j) => [j.jobTitle, j.koDeclined, j.total, j.reachedInterview, j.hired, `${j.hireRatePct}%`]),
                ]),
                "text/csv"
              )
            }
            disabled={data.byJob.length === 0}
            className="focus-ring inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white px-2.5 py-1 text-sm font-medium text-steel hover:bg-paper hover:text-ink disabled:opacity-50 print:hidden"
          >
            <Download size={12} aria-hidden /> {t("exportCsv")}
          </button>
        </div>
      </div>
      <table className="mt-3 w-full text-base">
        <thead>
          <tr className="border-b border-stone-200 text-left text-meta uppercase text-steel">
            <th className="pb-2 font-semibold">{t("colJob")}</th>
            <th className="pb-2 text-right font-semibold">{t("colKoDeclined")}</th>
            <th className="pb-2 text-right font-semibold">{t("colInPipeline")}</th>
            <th className="pb-2 text-right font-semibold">{t("colReachedInterview")}</th>
            <th className="pb-2 text-right font-semibold">{t("colHired")}</th>
            <th className="pb-2 text-right font-semibold">{t("colHireRate")}</th>
          </tr>
        </thead>
        <tbody>
          {data.byJob.map((j) => (
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
              <td className="py-2 text-right font-medium text-moss">{j.hireRatePct}%</td>
            </tr>
          ))}
          {data.byJob.length === 0 ? (
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
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
