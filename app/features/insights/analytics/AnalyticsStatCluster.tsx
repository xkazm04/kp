"use client";

import { useTranslations } from "next-intl";
import { useNumberFormat } from "@/app/_lib/use-number-format";
import { Stat } from "./AnalyticsStat";
import { timeToHireGoalChip } from "./statGoalChip";
import type { Analytics } from "./AnalyticsTypes";

// Compact key-stat cluster pinned to the top-right of the Analytics header;
// hairline dividers keep four figures in the space one full-size card used to
// take. Split out of AnalyticsTab.tsx to keep that file under the 200-line cap.
export function AnalyticsStatCluster({ data }: { data: Analytics }) {
  const t = useTranslations("analytics");
  // Every figure in the cluster is a count or a day span the reader compares at a
  // glance; they were painted as raw JS numbers, so a four-figure candidate total
  // rendered "45000" in every locale — un-grouped in en and simply wrong in cs/de/fr,
  // where the group separator is part of how a number is read.
  const n = useNumberFormat();
  const goalDays = data.targets.timeToHireDays;
  return (
    <div className="animate-arrive-in grid shrink-0 grid-cols-2 gap-px overflow-hidden rounded-lg border border-stone-200 bg-stone-200 shadow-panel lg:w-[22rem]">
      <Stat
        label={t("statCandidates")}
        value={n.grouped(data.total)}
        sub={t("activeSub", { count: data.active })}
        delta={data.deltas?.total}
      />
      <Stat
        label={t("statHired")}
        value={n.grouped(data.hired)}
        // Reject and decline read separately so the offer-acceptance signal
        // (candidates who turned us down) isn't hidden inside "rejected".
        // The value is the CREATION COHORT (`hired`: entries created in this window now
        // standing on a terminal stage). `hiresClosedInWindow` is the same figure on the
        // EVENT-TIME basis — hires whose terminal transition landed in the window — and
        // the two diverge by exactly the time-to-hire. Every per-hire figure elsewhere on
        // the tab divides by the event-time count, so when the two disagree the headline
        // says so instead of leaving a reader to wonder why the cost-per-hire denominator
        // is a different number. All-time cannot diverge, so the line is windowed-only.
        sub={
          [
            data.rejected ? t("rejectedSub", { count: data.rejected }) : null,
            data.declined ? t("declinedSub", { count: data.declined }) : null,
            data.windowDays != null && data.hiresClosedInWindow !== data.hired
              ? t("closedInWindowSub", { count: data.hiresClosedInWindow })
              : null,
          ]
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
        value={data.avgTimeToHireDays != null ? n.grouped(data.avgTimeToHireDays) : "—"}
        // The average NAMES ITS SAMPLE. `timeToHireSamples` is not `hired`: a hire whose
        // entry lacks one of the two timestamps is a real hire this mean cannot see (4 of
        // 9 on the shipped corpus), and an average over 5 observations presented as an
        // average over 9 is the exact misreading the metric pack's sample rule exists to
        // stop. Falls back to the bare label if a cached payload predates the field.
        sub={
          data.avgTimeToHireDays == null
            ? t("noHires")
            : data.timeToHireSamples > 0
              ? t("daysAvgOver", { count: data.timeToHireSamples })
              : t("daysAvg")
        }
        delta={data.deltas?.avgTimeToHireDays}
        unit="days"
        lowerIsBetter
        // Missed when the average exceeds the day goal; NULL — grey — when there is no
        // average at all, because a goal is not met by a cohort that produced no
        // measurement. The rule is a pure module (statGoalChip.ts) so a test executes
        // it; it used to live here as `!= null && >`, which collapsed "no hires in this
        // window" onto the MET colour.
        goalChip={timeToHireGoalChip(
          data.avgTimeToHireDays,
          goalDays,
          goalDays != null ? t("goalDays", { n: goalDays }) : ""
        )}
      />
      {/* Age is an as-of-now figure — no prior-window analogue, so no delta. */}
      <Stat label={t("statAge")} value={data.avgAgeDays != null ? n.grouped(data.avgAgeDays) : "—"} sub={data.avgAgeDays != null ? t("daysActive") : undefined} />
    </div>
  );
}
