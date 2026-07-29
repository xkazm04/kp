"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { Delta } from "@/app/_lib/analytics-deltas";
import { FunnelEmptyGuide } from "./AnalyticsFunnelEmptyGuide";
import { hasNoStageTransitions } from "./analyticsFunnelEmptyState";
import { DeltaChip } from "./AnalyticsDeltaChip";
import { OfferLegPanel } from "./AnalyticsOfferLegPanel";
import { GoalsEditor } from "./AnalyticsGoalsEditor";
import type { Analytics } from "./AnalyticsTypes";

// The primary funnel card: the stage bars, the KO-decline note, the bottleneck
// banner, per-stage dwell, the offer leg, and the goals editor. Split out of
// AnalyticsTab.tsx to keep that file under the 200-line cap.
export function AnalyticsFunnelPanel({
  data,
  enumLabel,
  maxReached,
  convDeltaByStage,
  boardHref,
  forceFunnelEmpty,
  reload,
}: {
  data: Analytics;
  enumLabel: (kind: string, value: string) => string;
  maxReached: number;
  convDeltaByStage: Map<string, Delta>;
  boardHref: (filter: { q?: string; stage?: string }) => string;
  forceFunnelEmpty: boolean;
  reload: () => void;
}) {
  const t = useTranslations("analytics");
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex items-baseline justify-between">
        <h3 className="font-serif text-h2 text-ink">{t("funnel")}</h3>
        <p className="text-meta uppercase text-steel">{t("funnelLegend")}</p>
      </div>
      {/* The loss BEFORE the funnel's first stage: KO-gate discards never
          mint an entry, so without this line the ad that attracts mostly
          ineligible applicants reads as a healthy low-volume channel. */}
      {data.koDeclined > 0 ? (
        <p className="mt-1 text-sm text-steel">{t("koDeclinedLine", { count: data.koDeclined })}</p>
      ) : null}
      {/* `?funnelEmpty=1` forces the funnel's own zero state for review. It is
          checked FIRST, ahead of the tab-level branch: on a workspace with no
          entries at all that branch wins and the preview never appears, which
          is exactly the trap it was added to avoid. Same dev-escape-hatch
          convention as `?onboarding=1` on '/'. */}
      {forceFunnelEmpty ? (
        <FunnelEmptyGuide
          funnel={data.funnel}
          stageLabel={(stage) => enumLabel("stage", stage)}
          links={[{ tab: "pipeline", label: "Open the pipeline board" }]}
        />
      ) : data.total === 0 ? (
        // Tab-level first run: nothing has ever existed. The tab's single
        // first-run hero is AnalyticsEmptyPreview (in the by-role table), so
        // the funnel stays a quiet one-liner here and doesn't compete.
        <p className="mt-4 rounded-md bg-paper p-3 text-base text-steel">{t("funnelEmpty")}</p>
      ) : hasNoStageTransitions(data.funnel) ? (
        // The FUNNEL's own zero state: candidates exist, but none has ever
        // crossed a stage boundary, so every conversion figure the funnel
        // could print is a "not yet" that renders as a column of zeros.
        <FunnelEmptyGuide
          funnel={data.funnel}
          stageLabel={(stage) => enumLabel("stage", stage)}
          links={[{ tab: "pipeline", label: "Open the pipeline board" }]}
        />
      ) : (
      <ul className="mt-4 space-y-2.5">
        {data.funnel.map((f) => (
          <li key={f.stage}>
            <Link
              href={boardHref({ stage: f.stage })}
              title={t("viewInBoard")}
              className="focus-ring -mx-1.5 flex items-center gap-3 rounded-md px-1.5 py-0.5 hover:bg-paper/70"
            >
            <span className="w-28 shrink-0 text-base font-medium text-ink">{enumLabel("stage", f.stage)}</span>
            <div
              className="relative h-7 flex-1 overflow-hidden rounded-md bg-paper"
              role="progressbar"
              aria-valuenow={f.reached}
              aria-valuemin={0}
              aria-valuemax={maxReached}
              aria-label={t("funnelBarAria", {
                stage: enumLabel("stage", f.stage),
                reached: f.reached,
                conv: f.conversionPct != null ? t("funnelConvSuffix", { pct: f.conversionPct }) : "",
              })}
            >
              <div
                className="h-full rounded-md bg-moss/25"
                style={{ width: `${Math.round((f.reached / maxReached) * 100)}%` }}
              />
              <div className="absolute inset-0 flex items-center gap-2 px-2.5 text-sm text-ink">
                <span className="font-semibold">{f.reached}</span>
                {f.current > 0 ? <span className="text-steel">{t("hereNow", { count: f.current })}</span> : null}
              </div>
            </div>
            <span className="flex w-20 shrink-0 flex-col items-end text-sm">
              {f.conversionPct != null ? (
                // 82c2b8e8 — miss the configurable goal (default 50% when unset)
                // → coral. The goal replaces the old hardcoded 50% threshold.
                <span className={f.conversionPct < (data.targets.conversion[f.stage] ?? 50) ? "text-coral" : "text-moss"}>
                  {f.conversionPct}%
                </span>
              ) : (
                <span className="text-steel">—</span>
              )}
              {data.targets.conversion[f.stage] != null ? (
                <span className="text-meta text-steel">{t("goalPct", { pct: data.targets.conversion[f.stage] })}</span>
              ) : null}
              {/* ce8e3c9e — conversion vs the previous equal-length window. */}
              {convDeltaByStage.get(f.stage) ? <DeltaChip delta={convDeltaByStage.get(f.stage)!} unit="pts" /> : null}
            </span>
            </Link>
          </li>
        ))}
      </ul>
      )}
      {data.bottleneck ? (
        <p className="mt-4 rounded-md border border-dial-amber/40 bg-dial-amber/10 px-3 py-2 text-base text-ink">
          {t.rich("bottleneck", {
            count: data.bottleneck.entryCount,
            stage: enumLabel("stage", data.bottleneck.stage),
            days: data.bottleneck.avgDaysInStage,
            b: (chunks) => <span className="font-semibold">{chunks}</span>,
            m: (chunks) => <span className="font-medium">{chunks}</span>,
          })}{" "}
          <Link
            href={boardHref({ stage: data.bottleneck.stage })}
            className="focus-ring rounded font-semibold text-coral underline-offset-2 hover:underline"
          >
            {t("viewCandidates")}
          </Link>
        </p>
      ) : null}
      {/* Full per-stage dwell (the bottleneck banner shows only the worst one).
          Surfaces the perStageDays the bottleneck already computes — Sloneek
          "time spent in each hiring stage per position". */}
      {data.stageDwell.length > 0 ? (
        <div className="mt-4">
          <p className="text-meta uppercase tracking-wide text-steel">{t("stageDwellTitle")}</p>
          <ul className="mt-1.5 space-y-1" role="list">
            {data.stageDwell.map((s) => (
              <li key={s.stage} className="flex items-baseline justify-between gap-2 text-base">
                <Link href={boardHref({ stage: s.stage })} className="focus-ring rounded text-ink hover:text-coral">
                  {enumLabel("stage", s.stage)}
                </Link>
                <span className="text-steel">{t("stageDwellRow", { days: s.avgDays, count: s.count })}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {/* Direction 1 — the offer leg: extended → accepted / declined / expired,
          the funnel's missing tail. Honesty-gated below the min-offers floor. */}
      <OfferLegPanel offers={data.offers} boardHref={boardHref} />
      {/* 82c2b8e8 — set the goal lines the funnel + time-to-hire flag against. */}
      <GoalsEditor
        stages={data.funnel.map((f) => f.stage)}
        conversion={data.targets.conversion}
        timeToHireDays={data.targets.timeToHireDays}
        onSaved={reload}
      />
    </div>
  );
}
