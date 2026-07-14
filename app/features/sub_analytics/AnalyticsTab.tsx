"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Download, PauseCircle, Target } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { downloadFile, toCsv } from "@/app/_lib/export-utils";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { useEnumLabel, labelOr } from "@/app/_lib/use-enum-label";
import { momentumWeekLabel, type MomentumWeek } from "@/app/_lib/analytics-momentum";
import { forecastHires } from "@/app/_lib/analytics-forecast";
import type { Delta, PeriodDeltas } from "@/app/_lib/analytics-deltas";
import { kindLabel, type AutomationImpact } from "@/app/_lib/decision-attribution";
import type { AutomationRoi } from "@/app/_lib/automation-roi";
// `import type` only — erased at compile time, no server code in the bundle.
import type { ChannelEconomics } from "@/app/_lib/db";
import type { VariantRecommendation, VariantStat } from "@/app/_lib/source-analytics";
import { buildUrl, clearedTabScopedParams } from "@/app/features/tabs";
import { useDeliveryCapability } from "@/app/features/useDeliveryCapability";
import { DecisionLog } from "./DecisionLog";
import { CalibrationPanel } from "./CalibrationPanel";
import { DecisionRecordsPanel } from "./DecisionRecordsPanel";
import { OrgBenchmarkPanel } from "./OrgBenchmarkPanel";

type Funnel = { stage: string; reached: number; current: number; conversionPct: number | null };
type Analytics = {
  total: number;
  active: number;
  hired: number;
  // Distinct terminal closes: company-side reject vs. candidate-side decline.
  rejected: number;
  declined: number;
  funnel: Funnel[];
  avgTimeToHireDays: number | null;
  // UAT M7 — blended overall cost per hire (Σ channel spend ÷ hires), all-time only.
  costPerHireCzk: number | null;
  avgAgeDays: number | null;
  bottleneck: { stage: string; avgDaysInStage: number; entryCount: number } | null;
  stageDwell: { stage: string; avgDays: number; count: number }[];
  byJob: { jobTitle: string; total: number; reachedInterview: number; hired: number; hireRatePct: number; koDeclined: number }[];
  byJobTotal: number;
  koDeclined: number;
  byArchetype: { archetype: string; total: number; hired: number; advanceRatePct: number }[];
  windowDays: number | null;
  momentum: MomentumWeek[];
  automation: AutomationImpact;
  // b39992b1 — recruiter-hours + CZK the automation saved over the window.
  automationRoi: AutomationRoi;
  bySource: { source: string; total: number; reachedInterview: number; hired: number; hireRatePct: number }[];
  // E5 — funnel economics over stored source attribution.
  byChannel: ChannelEconomics[];
  byVariant: VariantStat[];
  byVariantTotal: number;
  variantRecommendations: VariantRecommendation[];
  // ce8e3c9e — vs-previous-period diffs for the comparable scalars; null in the
  // all-time view (no "previous period" to compare against).
  deltas: PeriodDeltas | null;
  // 82c2b8e8 — recruiter-set goals: per-stage conversion %% targets + a TTH goal.
  targets: { conversion: Record<string, number>; timeToHireDays: number | null };
};

// ANA2 — the selectable windows. null = all time (the server default).
const WINDOW_CHOICES = [null, 30, 90] as const;

export function AnalyticsTab() {
  const t = useTranslations("analytics");
  const enumLabel = useEnumLabel();
  const search = useSearchParams();
  // ANA2 — cohort window. Changing it swaps the fetch URL; useJsonFetch refires
  // on the change (prior data stays visible until the new payload lands).
  const [days, setDays] = useState<number | null>(null);
  const { data, error, reload } = useJsonFetch<Analytics>(
    days ? `/api/analytics?days=${days}` : "/api/analytics",
    t("loadFailed")
  );

  // ANA1 — every chart links to the candidates behind it: a board deep link
  // carrying the matching filter (?stage= funnel stage, ?q= role title), with
  // the other tab-scoped params cleared so the board opens on exactly this
  // cohort. PipelineTab hydrates its filter bar from these at mount.
  const boardHref = (filter: { q?: string; stage?: string }) =>
    buildUrl({ ...clearedTabScopedParams(), tab: "pipeline", ...filter }, search.toString());

  if (error)
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-base text-coral">
        <span>{error}</span>
        <button
          type="button"
          onClick={reload}
          className="focus-ring inline-flex h-8 items-center rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:border-coral/40"
        >
          {t("retry")}
        </button>
      </div>
    );
  if (!data) return <p className="text-base text-steel">{t("loading")}</p>;

  const maxReached = Math.max(1, ...data.funnel.map((f) => f.reached));
  // ce8e3c9e — index the per-stage conversion deltas by stage for the funnel render.
  const convDeltaByStage = new Map((data.deltas?.funnel ?? []).map((f) => [f.stage, f.conversionPct]));

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-5 border-b border-stone-200 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
          <h2 className="mt-1 font-serif text-display text-ink">{t("title")}</h2>
          <p className="mt-2 max-w-3xl text-body text-steel">{t("intro")}</p>
          {/* ANA2: cohort window — every figure below scopes to entries created
              in the period (all-time stays the default). */}
          <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={t("windowLabel")}>
            {WINDOW_CHOICES.map((w) => (
              <button
                key={w ?? "all"}
                type="button"
                onClick={() => setDays(w)}
                aria-pressed={days === w}
                className={`focus-ring rounded-full border px-3 py-1 text-sm font-semibold transition-colors ${
                  days === w ? "border-coral bg-coral/10 text-coral" : "border-stone-200 text-steel hover:border-coral/40"
                }`}
              >
                {w == null ? t("windowAll") : t("windowDays", { days: w })}
              </button>
            ))}
          </div>
        </div>

        {/* Compact key-stat cluster pinned to the top-right; hairline dividers
            keep four figures in the space one full-size card used to take. */}
        <div className="grid shrink-0 grid-cols-2 gap-px overflow-hidden rounded-lg border border-stone-200 bg-stone-200 shadow-panel lg:w-[22rem]">
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
                    // Missed when we have an average and it exceeds the day goal.
                    missed: data.avgTimeToHireDays != null && data.avgTimeToHireDays > data.targets.timeToHireDays,
                  }
                : undefined
            }
          />
          {/* Age is an as-of-now figure — no prior-window analogue, so no delta. */}
          <Stat label={t("statAge")} value={data.avgAgeDays ?? "—"} sub={data.avgAgeDays != null ? t("daysActive") : undefined} />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
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
          {data.total === 0 ? (
            <p className="mt-4 rounded-md bg-paper p-3 text-base text-steel">{t("funnelEmpty")}</p>
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
          {/* 82c2b8e8 — set the goal lines the funnel + time-to-hire flag against. */}
          <GoalsEditor
            stages={data.funnel.map((f) => f.stage)}
            conversion={data.targets.conversion}
            timeToHireDays={data.targets.timeToHireDays}
            onSaved={reload}
          />
        </div>

        <div className="space-y-6">
          {/* 094b5870 — forward projection from the same velocity/conversion/TTH. */}
          <ForecastPanel funnel={data.funnel} momentum={data.momentum} avgTimeToHireDays={data.avgTimeToHireDays} />

          <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <h3 className="font-serif text-h2 text-ink">{t("byArchetype")}</h3>
            <ul className="mt-3 space-y-3">
              {data.byArchetype.map((a) => (
                <li key={a.archetype}>
                  <div className="flex items-baseline justify-between text-base">
                    <span className="font-medium text-ink">{enumLabel("archetype", a.archetype)}</span>
                    <span className="text-steel">{t("totalHired", { total: a.total, hired: a.hired })}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-paper">
                    <div className="h-full rounded-full bg-steel/40" style={{ width: `${a.advanceRatePct}%` }} />
                  </div>
                  <p className="mt-0.5 text-sm text-steel">{t("advancedPct", { pct: a.advanceRatePct })}</p>
                </li>
              ))}
              {data.byArchetype.length === 0 ? (
                <li className="text-base text-steel">{t("noArchetypeData")}</li>
              ) : null}
            </ul>
          </div>
          <AutomationPanel
            impact={data.automation}
            roi={data.automationRoi}
            costPerHireCzk={data.costPerHireCzk}
            timeToHireDays={data.avgTimeToHireDays}
            onSaved={reload}
            decisionsHref={buildUrl({ ...clearedTabScopedParams(), tab: "decisions" }, search.toString())}
          />
          <SourcePanel
            rows={data.bySource}
            channelsHref={buildUrl({ ...clearedTabScopedParams(), tab: "channels" }, search.toString())}
          />
        </div>
      </div>

      <MomentumPanel weeks={data.momentum} />

      <OrgBenchmarkPanel />

      <CalibrationPanel />

      <DecisionRecordsPanel />

      <ChannelEconomicsPanel
        rows={data.byChannel}
        variants={data.byVariant}
        variantTotal={data.byVariantTotal}
        recommendations={data.variantRecommendations}
        onSpendSaved={reload}
        windowed={data.windowDays != null}
      />

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
                <td colSpan={6} className="py-3 text-steel">
                  {t("noPipelineEntries")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <DecisionLog />
    </section>
  );
}

// ANA3 — "how much is the automation actually doing": the auto/human split plus
// the rollup rows, all folded through the SAME decision-attribution map the
// DecisionLog badges use, over the page's selected window.
function AutomationPanel({
  impact,
  roi,
  costPerHireCzk,
  timeToHireDays,
  onSaved,
  decisionsHref,
}: {
  impact: AutomationImpact;
  roi: AutomationRoi;
  costPerHireCzk: number | null;
  timeToHireDays: number | null;
  onSaved: () => void;
  decisionsHref: string;
}) {
  const t = useTranslations("analytics.automation");
  // REC-10 — "Comms delivered" is only claimed when a relay delivers; without
  // one the same count is truthfully "recorded in Outbox".
  const relayConfigured = useDeliveryCapability();
  const decided = impact.autoCount + impact.humanCount;
  const pct = decided > 0 ? Math.round((impact.autoCount / decided) * 100) : null;
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <h3 className="font-serif text-h2 text-ink">{t("title")}</h3>
      {pct == null ? (
        <p className="mt-3 text-base text-steel">{t("empty")}</p>
      ) : (
        <>
          <p className="mt-2 font-serif text-display leading-none text-ink">{t("headline", { pct })}</p>
          <p className="mt-1 text-sm text-steel">{t("split", { auto: impact.autoCount, human: impact.humanCount })}</p>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-paper" aria-hidden>
            <div className="h-full rounded-full bg-moss/60" style={{ width: `${pct}%` }} />
          </div>
          <ul className="mt-4 space-y-1.5 text-base">
            <ImpactRow label={t("autoAdvanced")} value={impact.autoAdvanced} />
            <ImpactRow label={t("autoRejected")} value={impact.autoRejected} />
            <li className="flex items-baseline justify-between gap-2">
              <span className="text-steel">{t("holds")}</span>
              {/* Holds are acted on in the Decisions queue — the figure links to
                  where the action happens, like the funnel bars do (ANA1). */}
              <Link
                href={decisionsHref}
                title={t("reviewHolds")}
                className="focus-ring rounded font-medium text-ink underline-offset-2 hover:text-coral hover:underline"
              >
                {t("holdsValue", { raised: impact.holdsRaised, resolved: impact.holdsResolved })}
              </Link>
            </li>
            <ImpactRow label={t(relayConfigured === false ? "commsQueued" : "comms")} value={impact.commsDelivered} />
          </ul>
          {/* b39992b1 — what that automation was WORTH, in recruiter-hours + CZK. */}
          <RoiLedger roi={roi} costPerHireCzk={costPerHireCzk} timeToHireDays={timeToHireDays} onSaved={onSaved} />
        </>
      )}
    </div>
  );
}

// b39992b1 — the counterfactual savings the automated trail bought, grounded in
// the same per-kind event counts the rollup uses, at the org's (override-able)
// hourly rate. Exportable like the decision log.
function RoiLedger({
  roi,
  costPerHireCzk,
  timeToHireDays,
  onSaved,
}: {
  roi: AutomationRoi;
  costPerHireCzk: number | null;
  timeToHireDays: number | null;
  onSaved: () => void;
}) {
  const t = useTranslations("analytics.roi");
  const tLog = useTranslations("analytics.log");
  // REC-10 — the ledger's per-kind rows reuse the event-kind labels; with no
  // relay a "…sent" kind renders its honest queued variant here too.
  const relayConfigured = useDeliveryCapability();
  const exportCsv = () => {
    downloadFile(
      "kp-automation-roi.csv",
      toCsv([
        // Leadership readout first (UAT M7) — the three figures a TA lead defends
        // upward — then the per-kind ledger they roll up from.
        [t("csvMetric"), t("csvValue")],
        [t("rdTimeSaved"), roi.pctOfManualBaseline != null ? `${roi.pctOfManualBaseline}%` : "—"],
        [t("csvHoursPerHire"), roi.hoursSavedPerHire ?? "—"],
        [t("rdCostPerHire"), costPerHireCzk ?? "—"],
        [t("rdTimeToHire"), timeToHireDays ?? "—"],
        [t("csvHoursTotal"), roi.hoursSaved],
        [t("csvCzkTotal"), roi.czkSaved],
        [],
        [t("csvKind"), t("csvCount"), t("csvMinsEach"), t("csvMinsTotal")],
        ...roi.actions.map((a) => [kindLabel(tLog, a.kind, { relayConfigured }), a.count, a.minutesEach, a.minutesTotal]),
      ]),
      "text/csv"
    );
  };
  return (
    <div className="mt-4 border-t border-stone-200 pt-3">
      <h4 className="text-meta uppercase tracking-wide text-steel">{t("title")}</h4>
      {roi.totalActions === 0 ? (
        <p className="mt-1 text-sm text-steel">{t("empty")}</p>
      ) : (
        <>
          <p className="mt-1 font-serif text-h2 leading-tight text-moss">
            {t("headline", { hours: roi.hoursSaved, czk: roi.czkSaved.toLocaleString("cs-CZ") })}
          </p>
          {/* Measured against the manual baseline (UAT M7): a reduction a leader can
              size, not a bare hour count. Honest "pending" until there's a hire. */}
          {roi.hoursSavedPerHire != null ? (
            <p className="mt-0.5 text-sm font-medium text-moss">
              {t("perHire", { hours: roi.hoursSavedPerHire, pct: roi.pctOfManualBaseline ?? 0, baseline: roi.manualBaselineHoursPerHire })}
            </p>
          ) : (
            <p className="mt-0.5 text-sm text-steel">{t("perHirePending")}</p>
          )}
          <p className="mt-0.5 text-sm text-steel">{t("basis", { actions: roi.totalActions, rate: roi.hourlyRateCzk })}</p>

          {/* Leadership readout (UAT M7): savings-vs-baseline + cost-per-hire +
              time-to-hire — the three scattered numbers, in one defensible place. */}
          <dl className="mt-3 grid grid-cols-3 gap-3 rounded-md bg-paper p-3">
            <div>
              <dt className="text-meta uppercase tracking-wide text-steel">{t("rdTimeSaved")}</dt>
              <dd className="mt-0.5 font-serif text-h3 text-ink">{roi.pctOfManualBaseline != null ? `${roi.pctOfManualBaseline}%` : "—"}</dd>
              <dd className="text-xs text-steel">{roi.hoursSavedPerHire != null ? t("rdPerHireSub", { hours: roi.hoursSavedPerHire }) : t("rdNoHires")}</dd>
            </div>
            <div>
              <dt className="text-meta uppercase tracking-wide text-steel">{t("rdCostPerHire")}</dt>
              <dd className="mt-0.5 font-serif text-h3 text-ink">{costPerHireCzk != null ? t("czkValue", { n: costPerHireCzk.toLocaleString("cs-CZ") }) : "—"}</dd>
              <dd className="text-xs text-steel">{t("rdAllTime")}</dd>
            </div>
            <div>
              <dt className="text-meta uppercase tracking-wide text-steel">{t("rdTimeToHire")}</dt>
              <dd className="mt-0.5 font-serif text-h3 text-ink">{timeToHireDays != null ? t("daysValue", { n: timeToHireDays }) : "—"}</dd>
              <dd className="text-xs text-steel">{t("rdMedian")}</dd>
            </div>
          </dl>

          <ul className="mt-3 space-y-1 text-sm">
            {roi.actions.slice(0, 5).map((a) => (
              <li key={a.kind} className="flex items-baseline justify-between gap-2">
                <span className="truncate text-steel">{t("actionRow", { label: kindLabel(tLog, a.kind, { relayConfigured }), count: a.count })}</span>
                <span className="shrink-0 font-medium text-ink">{t("minsSaved", { mins: a.minutesTotal })}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <TargetInput
              metric={RECRUITER_HOURLY_KEY}
              label={t("rateLabel")}
              value={roi.hourlyRateCzk}
              suffix={t("rateSuffix")}
              onSaved={onSaved}
            />
            <button
              type="button"
              onClick={exportCsv}
              className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 px-2.5 text-sm font-semibold text-ink hover:border-coral/40"
            >
              <Download size={13} /> {t("export")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ImpactRow({ label, value }: { label: string; value: number }) {
  return (
    <li className="flex items-baseline justify-between gap-2">
      <span className="text-steel">{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </li>
  );
}

// ANA4 — channel ROI: entries grouped by how they ENTERED the pipeline (derived
// server-side from each entry's earliest event kind), with the interview/hire
// payoff per channel. Answers "does the apply link or recruiter sourcing
// produce the candidates that actually get hired".
function SourcePanel({ rows, channelsHref }: { rows: Analytics["bySource"]; channelsHref: string }) {
  const t = useTranslations("analytics");
  const sourceLabel = (s: string) => labelOr(t, `source.${s}`, s);
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <h3 className="font-serif text-h2 text-ink">{t("bySource")}</h3>
      <ul className="mt-3 space-y-3">
        {rows.map((r) => (
          <li key={r.source}>
            <div className="flex items-baseline justify-between text-base">
              <span className="font-medium text-ink">{sourceLabel(r.source)}</span>
              <span className="font-medium text-moss">{r.hireRatePct}%</span>
            </div>
            <p className="mt-0.5 text-sm text-steel">
              {t("sourceLine", { total: r.total, interview: r.reachedInterview, hired: r.hired })}
            </p>
          </li>
        ))}
        {rows.length === 0 ? <li className="text-base text-steel">{t("noSourceData")}</li> : null}
      </ul>
      {/* Channel economics are configured on the Channels tab — give the ROI
          reading a destination instead of leaving it a dead report. */}
      <Link
        href={channelsHref}
        className="focus-ring mt-4 inline-flex items-center gap-1 text-sm font-semibold text-coral hover:underline"
      >
        {t("configureChannels")} <ArrowRight size={13} aria-hidden />
      </Link>
    </div>
  );
}

// E5 — channel economics: conversion + speed + cost per stored inbound channel
// (source_channel attribution), with recruiter-entered spend as the cost
// denominator; below it the per-creative variant table and the 72h pause
// recommendations (a suggestion, never an actuator — see source-analytics.ts).
function ChannelEconomicsPanel({
  rows,
  variants,
  variantTotal,
  recommendations,
  onSpendSaved,
  windowed,
}: {
  rows: ChannelEconomics[];
  variants: VariantStat[];
  variantTotal: number;
  recommendations: VariantRecommendation[];
  onSpendSaved: () => void;
  // True when a time window is selected: spend is a lifetime total, so cost-per
  // figures are suppressed (server returns null) and this note explains the "—".
  windowed: boolean;
}) {
  const t = useTranslations("analytics.channels");
  const format = useFormatter();
  const channelName = (channel: string) => labelOr(t, `names.${channel}`, channel);
  const czk = (n: number) => format.number(n);

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <h3 className="font-serif text-h2 text-ink">{t("title")}</h3>
      <p className="mt-1 max-w-3xl text-sm text-steel">{t("intro")}</p>

      {rows.length === 0 ? (
        <p className="mt-4 rounded-md bg-paper p-3 text-base text-steel">{t("empty")}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[44rem] text-base">
            <thead>
              <tr className="border-b border-stone-200 text-left text-meta uppercase text-steel">
                <th className="pb-2 font-semibold">{t("colChannel")}</th>
                <th className="pb-2 text-right font-semibold">{t("colLeads")}</th>
                <th className="pb-2 text-right font-semibold">{t("colInterview")}</th>
                <th className="pb-2 text-right font-semibold">{t("colHired")}</th>
                <th className="pb-2 text-right font-semibold">{t("colHireRate")}</th>
                <th className="pb-2 text-right font-semibold">{t("colDecisionTime")}</th>
                <th className="pb-2 text-right font-semibold">{t("colSpend")}</th>
                <th className="pb-2 text-right font-semibold">{t("colCpa")}</th>
                <th className="pb-2 text-right font-semibold">{t("colCph")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.channel} className="border-b border-stone-100 last:border-0">
                  <td className="py-2 pr-2 font-medium text-ink">{channelName(r.channel)}</td>
                  <td className="py-2 text-right text-steel">{r.total}</td>
                  <td className="py-2 text-right text-steel">{r.reachedInterview}</td>
                  <td className="py-2 text-right text-ink">{r.hired}</td>
                  <td className="py-2 text-right font-medium text-moss">{r.hireRatePct}%</td>
                  <td className="py-2 text-right text-steel">
                    {r.medianHoursToDecision != null ? t("hoursShort", { hours: r.medianHoursToDecision }) : "—"}
                  </td>
                  <td className="py-2 text-right">
                    <SpendInput channel={r.channel} channelLabel={channelName(r.channel)} value={r.spendCzk} onSaved={onSpendSaved} />
                  </td>
                  <td className="py-2 text-right text-ink">
                    {r.costPerApplicantCzk != null ? czk(r.costPerApplicantCzk) : "—"}
                  </td>
                  <td className="py-2 text-right text-ink">{r.costPerHireCzk != null ? czk(r.costPerHireCzk) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {windowed && rows.length > 0 ? <p className="mt-2 text-sm text-steel">{t("cpaWindowedNote")}</p> : null}

      {recommendations.length > 0 ? (
        <div className="mt-4 rounded-md border border-dial-amber/40 bg-dial-amber/10 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-base font-semibold text-ink">
            <PauseCircle size={15} aria-hidden /> {t("pauseTitle")}
          </p>
          <ul className="mt-1.5 list-inside list-disc space-y-1 text-base text-ink">
            {recommendations.map((r) => (
              <li key={`${r.jobTitle}|${r.campaign}|${r.variant}`}>
                {t.rich("pauseLine", {
                  variant: r.variant,
                  campaign: r.campaign ?? t("noCampaign"),
                  job: r.jobTitle ?? "—",
                  sharePct: r.leadSharePct,
                  groupTotal: r.groupTotal,
                  b: (chunks) => <span className="font-semibold">{chunks}</span>,
                })}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-sm text-steel">{t("pauseNote")}</p>
        </div>
      ) : null}

      {variants.length > 0 ? (
        <>
          <div className="mt-5 flex items-baseline justify-between gap-2">
            <h4 className="font-serif text-h3 text-ink">{t("variantsTitle")}</h4>
            {variantTotal > variants.length ? (
              <p className="text-meta uppercase text-steel">{t("topByVolume", { shown: variants.length, total: variantTotal })}</p>
            ) : null}
          </div>
          <table className="mt-2 w-full text-base">
            <thead>
              <tr className="border-b border-stone-200 text-left text-meta uppercase text-steel">
                <th className="pb-2 font-semibold">{t("colJob")}</th>
                <th className="pb-2 font-semibold">{t("colCampaign")}</th>
                <th className="pb-2 font-semibold">{t("colVariant")}</th>
                <th className="pb-2 text-right font-semibold">{t("colLeads")}</th>
                <th className="pb-2 text-right font-semibold">{t("colInterview")}</th>
                <th className="pb-2 text-right font-semibold">{t("colHired")}</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((v) => (
                <tr
                  key={`${v.jobId}|${v.campaign}|${v.variant}`}
                  className="border-b border-stone-100 last:border-0"
                  title={v.firstLeadAt ? t("firstLead", { date: format.dateTime(new Date(v.firstLeadAt), { day: "numeric", month: "short" }) }) : undefined}
                >
                  <td className="py-2 pr-2 text-ink">{v.jobTitle ?? "—"}</td>
                  <td className="py-2 pr-2 text-steel">{v.campaign ?? t("noCampaign")}</td>
                  <td className="py-2 pr-2 font-medium text-ink">{v.variant}</td>
                  <td className="py-2 text-right text-steel">{v.total}</td>
                  <td className="py-2 text-right text-steel">{v.reachedInterview}</td>
                  <td className="py-2 text-right text-ink">{v.hired}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </div>
  );
}

// E5 — inline spend editor: saves on blur/Enter, clears when emptied. The value
// re-syncs from the server after a save (the analytics reload), so the cost
// columns and the input always agree.
// One save-on-blur numeric input: holds the draft, re-seeds when the server
// `value` changes (the in-render prop-resync pattern), validates (blank → null;
// rejects non-finite/negative), short-circuits an unchanged value, and delegates
// the actual persistence to `onSave`. Each caller owns its own endpoint/body and
// supplies its label/suffix chrome around this. Extracted from the near-identical
// SpendInput/TargetInput (only endpoint/body + minor styling differed).
function InlineNumberSave({
  value,
  onSave,
  width,
  inputType = "text",
  inputClassName,
  ariaLabel,
  id,
  failedTitle,
}: {
  value: number | null;
  onSave: (value: number | null) => Promise<void>;
  width: string;
  inputType?: "text" | "number";
  inputClassName?: string;
  ariaLabel?: string;
  id?: string;
  failedTitle: string;
}) {
  const [draft, setDraft] = useState(value != null ? String(value) : "");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  // Re-seed when the server value changes (post-save reload) — the in-render
  // "adjust state when a prop changes" pattern used across the codebase.
  const [seeded, setSeeded] = useState(value);
  if (value !== seeded) {
    setSeeded(value);
    setDraft(value != null ? String(value) : "");
  }

  const save = async () => {
    const trimmed = draft.trim();
    const v = trimmed === "" ? null : Number(trimmed);
    if (v !== null && (!Number.isFinite(v) || v < 0)) {
      setFailed(true);
      return;
    }
    if (v === value) return; // unchanged — no request
    setSaving(true);
    setFailed(false);
    try {
      await onSave(v);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <input
      id={id}
      type={inputType}
      inputMode="numeric"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        if (failed) setFailed(false);
      }}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      disabled={saving}
      aria-label={ariaLabel}
      title={failed ? failedTitle : undefined}
      aria-invalid={failed ? true : undefined}
      placeholder="—"
      className={`focus-ring h-8 bg-white caret-coral placeholder:text-steel ${width} rounded-md border px-2 text-right disabled:opacity-50 ${inputClassName ?? ""} ${
        failed ? "border-coral text-coral" : "border-stone-200 text-ink"
      }`}
    />
  );
}

function SpendInput({
  channel,
  channelLabel,
  value,
  onSaved,
}: {
  channel: string;
  channelLabel: string;
  value: number | null;
  onSaved: () => void;
}) {
  const t = useTranslations("analytics.channels");
  return (
    <InlineNumberSave
      value={value}
      width="w-24"
      inputClassName="text-sm"
      ariaLabel={t("spendAria", { channel: channelLabel })}
      failedTitle={t("spendSaveFailed")}
      onSave={async (amount) => {
        const r = await fetch("/api/analytics/spend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel, amountCzk: amount }),
        });
        if (!r.ok) throw new Error();
        onSaved();
      }}
    />
  );
}

// 094b5870 — forward hire projection, computed client-side from the same payload
// the rest of the page renders (pure forecastHires — no extra fetch). Shows the
// expected hires already in flight, an inflow projection over a few horizons, and
// the average time-to-hire as the realization lag. Below the signal floor (no
// hires observed yet) it says so rather than projecting a misleading zero.
function ForecastPanel({
  funnel,
  momentum,
  avgTimeToHireDays,
}: {
  funnel: Funnel[];
  momentum: MomentumWeek[];
  avgTimeToHireDays: number | null;
}) {
  const t = useTranslations("analytics.forecast");
  const f = forecastHires({
    weeklyAdded: momentum.map((w) => w.added),
    funnel: funnel.map((r) => ({ stage: r.stage, reached: r.reached, current: r.current })),
    avgTimeToHireDays,
  });
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <h3 className="font-serif text-h2 text-ink">{t("title")}</h3>
      {!f.hasSignal ? (
        <p className="mt-3 rounded-md bg-paper p-3 text-base text-steel">{t("noSignal")}</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-steel">
            {t("basis", { velocity: f.weeklyVelocity, conv: f.overallConversionPct ?? 0 })}
          </p>
          <dl className="mt-3 space-y-2">
            <div className="flex items-baseline justify-between">
              <dt className="text-base text-ink">{t("inFlight")}</dt>
              <dd className="font-serif text-h2 leading-none text-moss">{f.inFlightExpectedHires}</dd>
            </div>
            {f.projected.map((p) => (
              <div key={p.weeks} className="flex items-baseline justify-between border-t border-stone-100 pt-2">
                <dt className="text-base text-steel">{t("horizon", { weeks: p.weeks })}</dt>
                <dd className="text-base font-semibold text-ink">{t("plusHires", { hires: p.hires })}</dd>
              </div>
            ))}
          </dl>
          {f.etaDays != null ? <p className="mt-3 text-meta text-steel">{t("eta", { days: f.etaDays })}</p> : null}
        </>
      )}
    </div>
  );
}

// 82c2b8e8 / b39992b1 — mirror the server's reserved analytics_targets keys.
// Declared locally so the client doesn't import the db barrel (better-sqlite3)
// for two strings.
const TIME_TO_HIRE_KEY = "time_to_hire";
const RECRUITER_HOURLY_KEY = "recruiter_hourly_czk";

// 82c2b8e8 — collapsible goal editor. Per-stage conversion % goals + one
// time-to-hire goal (days), persisted via /api/analytics/targets. The funnel
// colors a stage coral when it misses its goal; the time-to-hire stat shows a
// met/missed pill. Skips the first funnel stage (no inbound conversion ratio).
function GoalsEditor({
  stages,
  conversion,
  timeToHireDays,
  onSaved,
}: {
  stages: string[];
  conversion: Record<string, number>;
  timeToHireDays: number | null;
  onSaved: () => void;
}) {
  const t = useTranslations("analytics.goals");
  const enumLabel = useEnumLabel();
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 border-t border-stone-200 pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="focus-ring flex items-center gap-1.5 rounded text-sm font-semibold text-steel hover:text-ink"
      >
        <Target size={14} /> {t("title")}
      </button>
      {open ? (
        <div className="mt-2 space-y-1.5">
          <p className="text-meta text-steel">{t("intro")}</p>
          {stages.slice(1).map((stage) => (
            <TargetInput
              key={stage}
              metric={stage}
              label={enumLabel("stage", stage)}
              value={conversion[stage] ?? null}
              suffix="%"
              onSaved={onSaved}
            />
          ))}
          <TargetInput
            metric={TIME_TO_HIRE_KEY}
            label={t("timeToHire")}
            value={timeToHireDays}
            suffix={t("daysSuffix")}
            onSaved={onSaved}
          />
        </div>
      ) : null}
    </div>
  );
}

function TargetInput({
  metric,
  label,
  value,
  suffix,
  onSaved,
}: {
  metric: string;
  label: string;
  value: number | null;
  suffix: string;
  onSaved: () => void;
}) {
  const t = useTranslations("analytics.goals");
  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor={`goal-${metric}`} className="w-28 shrink-0 text-steel">
        {label}
      </label>
      <InlineNumberSave
        id={`goal-${metric}`}
        value={value}
        width="w-20"
        inputType="number"
        failedTitle={t("saveFailed")}
        onSave={async (v) => {
          const r = await fetch("/api/analytics/targets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ metric, value: v }),
          });
          if (!r.ok) throw new Error();
          onSaved();
        }}
      />
      <span className="text-meta text-steel">{suffix}</span>
    </div>
  );
}

// ANA2 — the weekly trend: grouped mini-bars per rolling week (newest right),
// one bar per series. Heights normalize against the single largest weekly count
// so weeks compare honestly across the whole span.
const MOMENTUM_SERIES = [
  { key: "added", legend: "legendAdded", bar: "bg-steel/50" },
  { key: "advanced", legend: "legendAdvanced", bar: "bg-moss/70" },
  { key: "rejected", legend: "legendRejected", bar: "bg-coral/70" },
  { key: "hired", legend: "legendHired", bar: "bg-ink" },
] as const;

function MomentumPanel({ weeks }: { weeks: MomentumWeek[] }) {
  const t = useTranslations("analytics");
  const locale = useLocale();
  const max = Math.max(1, ...weeks.flatMap((w) => MOMENTUM_SERIES.map((s) => w[s.key])));
  const quiet = weeks.every((w) => MOMENTUM_SERIES.every((s) => w[s.key] === 0));
  // weekStart is a UTC calendar date; render it pinned to UTC so the label shows the
  // correct day in every client timezone (see momentumWeekLabel).
  const weekLabel = (iso: string) => momentumWeekLabel(iso, locale);
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-serif text-h2 text-ink">{t("momentum")}</h3>
        <ul className="flex flex-wrap items-center gap-3 text-sm text-steel">
          {MOMENTUM_SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden className={`h-2.5 w-2.5 rounded-sm ${s.bar}`} />
              {t(s.legend)}
            </li>
          ))}
        </ul>
      </div>
      {quiet ? (
        <p className="mt-4 rounded-md bg-paper p-3 text-base text-steel">{t("momentumEmpty")}</p>
      ) : (
        <ol className="mt-4 flex items-end gap-2">
          {weeks.map((w) => (
            <li key={w.weekStart} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              {/* role="img" + aria-label is the reliable text equivalent: a bare
                  <li aria-label> isn't announced across SRs. The role makes the bar
                  group's decorative children presentational automatically. */}
              <div
                role="img"
                aria-label={t("momentumWeekAria", {
                  date: weekLabel(w.weekStart),
                  added: w.added,
                  advanced: w.advanced,
                  rejected: w.rejected,
                  hired: w.hired,
                })}
                className="flex h-20 w-full items-end justify-center gap-0.5 rounded-md bg-paper px-1 pt-1"
              >
                {MOMENTUM_SERIES.map((s) => (
                  <div
                    key={s.key}
                    title={`${t(s.legend)}: ${w[s.key]}`}
                    className={`w-1/5 max-w-3 rounded-t-sm ${s.bar}`}
                    style={{ height: `${Math.round((w[s.key] / max) * 100)}%` }}
                  />
                ))}
              </div>
              <span aria-hidden className="truncate text-sm text-steel">{weekLabel(w.weekStart)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  delta,
  lowerIsBetter,
  unit,
  goalChip,
}: {
  label: string;
  value: string | number;
  sub?: string;
  delta?: Delta;
  // For time-to-hire a smaller number is the win, so a negative delta is good.
  lowerIsBetter?: boolean;
  unit?: "pts" | "days";
  // 82c2b8e8 — a "goal Nd" pill, coral when the figure misses the goal.
  goalChip?: { text: string; missed: boolean };
}) {
  return (
    <div className="bg-white px-4 py-2.5">
      <p className="text-meta uppercase text-steel">{label}</p>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <p className="font-serif text-h2 leading-none text-ink">{value}</p>
        {delta ? <DeltaChip delta={delta} lowerIsBetter={lowerIsBetter} unit={unit} /> : null}
        {goalChip ? (
          <span className={`rounded px-1 py-0.5 text-meta font-semibold ${goalChip.missed ? "bg-coral/10 text-coral" : "bg-moss/10 text-moss"}`}>
            {goalChip.text}
          </span>
        ) : null}
      </div>
      {sub ? <p className="mt-0.5 text-sm text-steel">{sub}</p> : null}
    </div>
  );
}

// ce8e3c9e — a compact "+4 pts" / "−3 d" vs-previous chip. Green/coral keys off
// whether the change is an IMPROVEMENT (direction-aware: for time-to-hire, down
// is good), so the color reads as good/bad, not up/down. A null delta (no prior
// baseline, e.g. an empty previous window) renders nothing.
function DeltaChip({ delta, lowerIsBetter, unit }: { delta: Delta; lowerIsBetter?: boolean; unit?: "pts" | "days" }) {
  const t = useTranslations("analytics");
  if (delta.delta == null || delta.delta === 0) {
    return delta.delta === 0 ? <span className="text-meta text-steel">{t("deltaFlat")}</span> : null;
  }
  const improved = lowerIsBetter ? delta.delta < 0 : delta.delta > 0;
  const sign = delta.delta > 0 ? "+" : "−";
  const magnitude = Math.abs(delta.delta);
  const text =
    unit === "pts"
      ? t("deltaPts", { sign, n: magnitude })
      : unit === "days"
        ? t("deltaDays", { sign, n: magnitude })
        : `${sign}${magnitude}`;
  return (
    <span
      className={`rounded px-1 py-0.5 text-meta font-semibold ${improved ? "bg-moss/10 text-moss" : "bg-coral/10 text-coral"}`}
      title={t("deltaTitle")}
    >
      {text}
    </span>
  );
}
