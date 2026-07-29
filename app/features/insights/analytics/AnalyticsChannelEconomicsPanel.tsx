"use client";

import { useFormatter, useTranslations } from "next-intl";
import { PauseCircle } from "lucide-react";
import { labelOr } from "@/app/_lib/use-enum-label";
import type { ChannelDelta } from "@/app/_lib/analytics-deltas";
// `import type` only — erased at compile time, no server code in the bundle.
import type { ChannelEconomics } from "@/app/_lib/db";
import type { VariantRecommendation, VariantStat } from "@/app/_lib/source-analytics";
import { DeltaChip } from "./AnalyticsTab";
import { SpendInput } from "./AnalyticsChannelSpendInput";

// E5 — channel economics: conversion + speed + cost per stored inbound channel
// (source_channel attribution), with recruiter-entered spend as the cost
// denominator; below it the per-creative variant table and the 72h pause
// recommendations (a suggestion, never an actuator — see source-analytics.ts).
//
// Loading choreography (docs/LOADING_CHOREOGRAPHY.md, tier 3): split out of
// AnalyticsTab.tsx into its own next/dynamic chunk — two tables + a
// recommendations block, below the fold, that most sessions scroll past.
export function ChannelEconomicsPanel({
  rows,
  deltas,
  variants,
  variantTotal,
  recommendations,
  onSpendSaved,
  windowed,
}: {
  rows: ChannelEconomics[];
  deltas: ChannelDelta[] | null;
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
  // Direction 2 — vs-prior movement per channel; null in the all-time view.
  const deltaByChannel = new Map((deltas ?? []).map((d) => [d.channel, d]));

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <h3 className="font-serif text-h2 text-ink">{t("title")}</h3>
      {/* channel-story-complete — the coherence cue paired with SourcePanel's
          "by first-touch origin": this table groups the stored source_channel. */}
      <p className="mt-0.5 text-meta uppercase tracking-wide text-steel">{t("recordedHint")}</p>
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
              {rows.map((r) => {
                const d = deltaByChannel.get(r.channel);
                return (
                <tr key={r.channel} className="border-b border-stone-100 last:border-0">
                  <td className="py-2 pr-2 font-medium text-ink">{channelName(r.channel)}</td>
                  <td className="py-2 text-right text-steel">
                    <span className="inline-flex items-baseline gap-1.5">
                      {r.total}
                      {/* vs the prior equal-length window — lead volume movement. */}
                      {d?.volume ? <DeltaChip delta={d.volume} /> : null}
                    </span>
                  </td>
                  <td className="py-2 text-right text-steel">{r.reachedInterview}</td>
                  <td className="py-2 text-right text-ink">{r.hired}</td>
                  <td className="py-2 text-right font-medium text-moss">
                    <span className="inline-flex items-baseline gap-1.5">
                      {r.hireRatePct}%
                      {d?.conversionPct ? <DeltaChip delta={d.conversionPct} unit="pts" /> : null}
                    </span>
                  </td>
                  <td className="py-2 text-right text-steel">
                    {r.medianHoursToDecision != null ? t("hoursShort", { hours: r.medianHoursToDecision }) : "—"}
                  </td>
                  <td className="py-2 text-right">
                    <SpendInput channel={r.channel} channelLabel={channelName(r.channel)} value={r.spendCzk} onSaved={onSpendSaved} />
                  </td>
                  <td className="py-2 text-right text-ink">
                    <span className="inline-flex items-baseline gap-1.5">
                      {r.costPerApplicantCzk != null ? czk(r.costPerApplicantCzk) : "—"}
                      {/* Lower CPA is the win; null in windowed views (lifetime spend). */}
                      {d?.costPerApplicantCzk ? <DeltaChip delta={d.costPerApplicantCzk} lowerIsBetter /> : null}
                    </span>
                  </td>
                  <td className="py-2 text-right text-ink">{r.costPerHireCzk != null ? czk(r.costPerHireCzk) : "—"}</td>
                </tr>
                );
              })}
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

// E5 — SpendInput now lives in ./AnalyticsChannelSpendInput.tsx (its own module,
// keeping this file under the 200-line cap).
