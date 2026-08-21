"use client";

import { useTranslations } from "next-intl";
import { Stat } from "./AnalyticsStat";
import type { Analytics } from "./AnalyticsTypes";

// Compact key-stat cluster pinned to the top-right of the Analytics header;
// hairline dividers keep four figures in the space one full-size card used to
// take. Split out of AnalyticsTab.tsx to keep that file under the 200-line cap.
export function AnalyticsStatCluster({ data }: { data: Analytics }) {
  const t = useTranslations("analytics");
  return (
    <div className="animate-arrive-in grid shrink-0 grid-cols-2 gap-px overflow-hidden rounded-lg border border-stone-200 bg-stone-200 shadow-panel lg:w-[22rem]">
      <Stat
        label={t("statCandidates")}
        value={data.total}
        sub={t("activeSub", { count: data.active })}
        delta={data.deltas?.total}
      />
      <Stat
        label={t("statHired")}
        value={data.hired}
        // Reject and decline read separately so the offer-acceptance signal
        // (candidates who turned us down) isn't hidden inside "rejected".
        sub={
          [data.rejected ? t("rejectedSub", { count: data.rejected }) : null, data.declined ? t("declinedSub", { count: data.declined }) : null]
            .filter(Boolean)
            .join(" · ") || undefined
        }
        // The headline movement is hire RATE (delta shown as pts) — an absolute
        // hire count rises with volume; the rate is the quality signal.
        delta={data.deltas?.hireRatePct}
        unit="pts"
      />
      <Stat
        label={t("statTimeToHire")}
        value={data.avgTimeToHireDays ?? "—"}
        sub={data.avgTimeToHireDays != null ? t("daysAvg") : t("noHires")}
        delta={data.deltas?.avgTimeToHireDays}
        unit="days"
        lowerIsBetter
        goalChip={
          data.targets.timeToHireDays != null
            ? {
                text: t("goalDays", { n: data.targets.timeToHireDays }),
                // Missed when the average exceeds the day goal; NULL when there is no
                // average at all. `!= null && >` collapsed "no hires in this window"
                // onto `false`, i.e. onto the met colour — a green goal pill beside a
                // "—" and „no hires yet". A goal is not met by a cohort that produced
                // no measurement; that state is grey (a reading, not a verdict).
                missed: data.avgTimeToHireDays == null ? null : data.avgTimeToHireDays > data.targets.timeToHireDays,
              }
            : undefined
        }
      />
      {/* Age is an as-of-now figure — no prior-window analogue, so no delta. */}
      <Stat label={t("statAge")} value={data.avgAgeDays ?? "—"} sub={data.avgAgeDays != null ? t("daysActive") : undefined} />
    </div>
  );
}
