"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Download, PauseCircle } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { downloadFile, toCsv } from "@/app/_lib/export-utils";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { MomentumWeek } from "@/app/_lib/analytics-momentum";
import type { Delta, PeriodDeltas } from "@/app/_lib/analytics-deltas";
import type { AutomationImpact } from "@/app/_lib/decision-attribution";
// `import type` only — erased at compile time, no server code in the bundle.
import type { ChannelEconomics } from "@/app/_lib/db";
import type { VariantRecommendation, VariantStat } from "@/app/_lib/source-analytics";
import { buildUrl, clearedTabScopedParams } from "@/app/features/tabs";
import { DecisionLog } from "./DecisionLog";

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
  avgAgeDays: number | null;
  bottleneck: { stage: string; avgDaysInStage: number; entryCount: number } | null;
  byJob: { jobTitle: string; total: number; reachedInterview: number; hired: number; hireRatePct: number }[];
  byJobTotal: number;
  byArchetype: { archetype: string; total: number; hired: number; advanceRatePct: number }[];
  windowDays: number | null;
  momentum: MomentumWeek[];
  automation: AutomationImpact;
  bySource: { source: string; total: number; reachedInterview: number; hired: number; hireRatePct: number }[];
  // E5 — funnel economics over stored source attribution.
  byChannel: ChannelEconomics[];
  byVariant: VariantStat[];
  byVariantTotal: number;
  variantRecommendations: VariantRecommendation[];
  // ce8e3c9e — vs-previous-period diffs for the comparable scalars; null in the
  // all-time view (no "previous period" to compare against).
  deltas: PeriodDeltas | null;
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
                    <span className={f.conversionPct < 50 ? "text-coral" : "text-moss"}>{f.conversionPct}%</span>
                  ) : (
                    <span className="text-steel">—</span>
                  )}
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
        </div>

        <div className="space-y-6">
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
            decisionsHref={buildUrl({ ...clearedTabScopedParams(), tab: "decisions" }, search.toString())}
          />
          <SourcePanel
            rows={data.bySource}
            channelsHref={buildUrl({ ...clearedTabScopedParams(), tab: "channels" }, search.toString())}
          />
        </div>
      </div>

      <MomentumPanel weeks={data.momentum} />

      <ChannelEconomicsPanel
        rows={data.byChannel}
        variants={data.byVariant}
        variantTotal={data.byVariantTotal}
        recommendations={data.variantRecommendations}
        onSpendSaved={reload}
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
                    [t("colJob"), t("colInPipeline"), t("colReachedInterview"), t("colHired"), t("colHireRate")],
                    ...data.byJob.map((j) => [j.jobTitle, j.total, j.reachedInterview, j.hired, `${j.hireRatePct}%`]),
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
                <td className="py-2 text-right text-steel">{j.total}</td>
                <td className="py-2 text-right text-steel">{j.reachedInterview}</td>
                <td className="py-2 text-right text-ink">{j.hired}</td>
                <td className="py-2 text-right font-medium text-moss">{j.hireRatePct}%</td>
              </tr>
            ))}
            {data.byJob.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-3 text-steel">
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
function AutomationPanel({ impact, decisionsHref }: { impact: AutomationImpact; decisionsHref: string }) {
  const t = useTranslations("analytics.automation");
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
            <ImpactRow label={t("comms")} value={impact.commsDelivered} />
          </ul>
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
  const sourceLabel = (s: string) => {
    const key = `source.${s}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : s;
  };
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
}: {
  rows: ChannelEconomics[];
  variants: VariantStat[];
  variantTotal: number;
  recommendations: VariantRecommendation[];
  onSpendSaved: () => void;
}) {
  const t = useTranslations("analytics.channels");
  const format = useFormatter();
  const channelName = (channel: string) => {
    const key = `names.${channel}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : channel;
  };
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
    const amount = trimmed === "" ? null : Number(trimmed);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      setFailed(true);
      return;
    }
    if (amount === value) return; // unchanged — no request
    setSaving(true);
    setFailed(false);
    try {
      const r = await fetch("/api/analytics/spend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, amountCzk: amount }),
      });
      if (!r.ok) throw new Error();
      onSaved();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <input
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
      aria-label={t("spendAria", { channel: channelLabel })}
      title={failed ? t("spendSaveFailed") : undefined}
      aria-invalid={failed ? true : undefined}
      placeholder="—"
      className={`focus-ring h-8 w-24 rounded-md border px-2 text-right text-sm disabled:opacity-50 ${
        failed ? "border-coral text-coral" : "border-stone-200 text-ink"
      }`}
    />
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
  const format = useFormatter();
  const max = Math.max(1, ...weeks.flatMap((w) => MOMENTUM_SERIES.map((s) => w[s.key])));
  const quiet = weeks.every((w) => MOMENTUM_SERIES.every((s) => w[s.key] === 0));
  const weekLabel = (iso: string) =>
    format.dateTime(new Date(`${iso}T00:00:00`), { day: "numeric", month: "short" });
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
            <li
              key={w.weekStart}
              className="flex min-w-0 flex-1 flex-col items-center gap-1"
              aria-label={t("momentumWeekAria", {
                date: weekLabel(w.weekStart),
                added: w.added,
                advanced: w.advanced,
                rejected: w.rejected,
                hired: w.hired,
              })}
            >
              <div aria-hidden className="flex h-20 w-full items-end justify-center gap-0.5 rounded-md bg-paper px-1 pt-1">
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
}: {
  label: string;
  value: string | number;
  sub?: string;
  delta?: Delta;
  // For time-to-hire a smaller number is the win, so a negative delta is good.
  lowerIsBetter?: boolean;
  unit?: "pts" | "days";
}) {
  return (
    <div className="bg-white px-4 py-2.5">
      <p className="text-meta uppercase text-steel">{label}</p>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <p className="font-serif text-h2 leading-none text-ink">{value}</p>
        {delta ? <DeltaChip delta={delta} lowerIsBetter={lowerIsBetter} unit={unit} /> : null}
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
