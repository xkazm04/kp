"use client";

// VARIANT B — "Payback". Metaphor: an investment case, not an expense report.
//
// The statement variant answers "what did this cost". This one answers the
// question a recruiter actually acts on: "where should the next koruna go?" It
// leads with the net position, then plots every channel on ONE cost-per-hire
// axis against the blended average, so cheap and expensive are a spatial fact
// rather than a column you sort.
//
// What differs, structurally:
//   • a single headline verdict computed from the data, not a grid of figures;
//   • one shared axis for all channels — the comparison IS the chart, where the
//     baseline's table leaves the reader to compare numbers down a column;
//   • the blended average is drawn as a reference line, so "better or worse than
//     us overall" needs no arithmetic;
//   • channels with spend but no hires are shown as an open bar at the axis end,
//     not omitted — money spent for nothing is the finding, not a missing row.
import { useTranslations } from "next-intl";
import { TrendingDown, TrendingUp } from "lucide-react";
import { useNumberFormat } from "@/app/_lib/use-number-format";
import { labelOr } from "@/app/_lib/use-enum-label";
import { PANEL } from "@/app/_components/ui/recipes";
import { Defer } from "@/app/_components/ui/Defer";
import { SpendInput } from "../AnalyticsChannelSpendInput";
import { ComputeCostPanel, SourcePanel } from "./sectionChunks";
import { buildUrl, clearedTabScopedParams } from "@/app/features/shell/tabs";
import type { EconomicsProps } from "./economicsTypes";

export function EconomicsPayback({ data, reload, tabScopedSearch }: EconomicsProps) {
  const t = useTranslations("analytics.econ");
  const tc = useTranslations("analytics.channels");
  const { money } = useNumberFormat();
  const channelName = (channel: string) => labelOr(tc, `names.${channel}`, channel);
  const windowed = data.windowDays != null;

  // Only channels with recorded spend can be plotted — a channel with no spend
  // entered has no cost per hire, and guessing one would invent the finding.
  const funded = data.byChannel.filter((r) => (r.spendCzk ?? 0) > 0);
  const priced = funded.filter((r) => r.costPerHireCzk != null);
  const unconverted = funded.filter((r) => r.costPerHireCzk == null && r.hired === 0);
  const blended = data.costPerHireCzk;
  // The axis runs to the worst real cost per hire (or the blended average when
  // that is worse), so the reference line always lands inside the plot.
  const axisMax = Math.max(1, ...priced.map((r) => r.costPerHireCzk ?? 0), blended ?? 0);
  const pct = (v: number) => `${Math.min(100, Math.round((v / axisMax) * 100))}%`;

  const best = priced.length > 0 ? priced.reduce((a, b) => ((a.costPerHireCzk ?? 0) <= (b.costPerHireCzk ?? 0) ? a : b)) : null;
  const worst = priced.length > 0 ? priced.reduce((a, b) => ((a.costPerHireCzk ?? 0) >= (b.costPerHireCzk ?? 0) ? a : b)) : null;

  return (
    <div className="animate-arrive-in space-y-6">
      {/* ---- The net position, stated once ---------------------------------- */}
      <section className={`${PANEL} p-5`}>
        <p className="text-meta uppercase text-coral">{t("paybackEyebrow")}</p>
        {data.automationRoi.hoursSaved > 0 ? (
          <p className="mt-2 max-w-4xl text-balance font-serif text-h1 leading-tight text-ink">
            {t("paybackLede", {
              hours: data.automationRoi.hoursSaved,
              czk: money(data.automationRoi.czkSaved),
            })}
          </p>
        ) : (
          <p className="mt-2 max-w-4xl text-balance font-serif text-h1 leading-tight text-ink">{t("paybackNoRoi")}</p>
        )}
        {/* The "channels below that line" half is only true when there ARE
            channels on the axis. With no spend recorded it promises a comparison
            the page cannot show, so the sentence drops to the bare figure. */}
        <p className="mt-3 max-w-2xl text-body leading-relaxed text-steel">
          {blended != null
            ? priced.length > 0
              ? t("paybackBlended", { czk: money(blended) })
              : t("paybackBlendedNoChannels", { czk: money(blended) })
            : windowed
              ? t("paybackWindowed")
              : t("paybackNoBlend")}
        </p>
        {data.automationRoi.pctOfManualBaseline != null ? (
          <p className="mt-1 max-w-2xl text-body text-steel">
            {t("paybackBaseline", { pct: data.automationRoi.pctOfManualBaseline })}
          </p>
        ) : null}
      </section>

      {/* ---- One axis, every funded channel --------------------------------- */}
      <section className={`${PANEL} p-5`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-serif text-h2 text-ink">{t("axisTitle")}</h3>
          <p className="text-meta uppercase text-steel">{t("axisLegend")}</p>
        </div>

        {funded.length === 0 ? (
          <p className="mt-4 rounded-md bg-paper p-3 text-base text-steel">{t("axisEmpty")}</p>
        ) : (
          <>
            <ul className="mt-5 space-y-3">
              {priced
                .slice()
                .sort((a, b) => (a.costPerHireCzk ?? 0) - (b.costPerHireCzk ?? 0))
                .map((r) => {
                  const value = r.costPerHireCzk ?? 0;
                  const beatsBlended = blended != null && value <= blended;
                  return (
                    <li key={r.channel} className="flex items-center gap-3">
                      <span className="w-32 shrink-0 truncate text-base font-medium text-ink" title={channelName(r.channel)}>
                        {channelName(r.channel)}
                      </span>
                      <span className="relative h-6 flex-1 rounded-md bg-paper">
                        <span
                          className={`absolute inset-y-0 left-0 rounded-md ${beatsBlended ? "bg-moss/35" : "bg-coral/30"}`}
                          style={{ width: pct(value) }}
                        />
                        {/* The blended average as a reference line: "better or
                            worse than us overall" without any arithmetic. */}
                        {blended != null ? (
                          <span className="absolute inset-y-0 w-px bg-ink/50" style={{ left: pct(blended) }} aria-hidden />
                        ) : null}
                      </span>
                      <span className="w-28 shrink-0 text-right text-base nums">
                        <span className={beatsBlended ? "font-semibold text-moss" : "text-ink"}>{money(value)}</span>
                      </span>
                      <span className="w-20 shrink-0 text-right text-sm text-steel nums">
                        {t("hiresCount", { n: r.hired })}
                      </span>
                    </li>
                  );
                })}
            </ul>

            {/* Money spent that bought nothing — the finding the baseline's table
                lets you scroll past, because a null cost-per-hire renders as a
                quiet dash in a column of numbers. */}
            {unconverted.length > 0 ? (
              <div className="mt-5 rounded-md border border-coral/30 bg-coral/5 p-3">
                <p className="text-base font-semibold text-ink">{t("sunkTitle")}</p>
                <ul className="mt-1.5 space-y-1">
                  {unconverted.map((r) => (
                    <li key={r.channel} className="flex items-baseline justify-between gap-3 text-base">
                      <span className="text-ink">{channelName(r.channel)}</span>
                      <span className="flex items-baseline gap-3">
                        <span className="text-sm text-steel">{t("leadsCount", { n: r.total })}</span>
                        <span className="nums font-semibold text-coral">{money(r.spendCzk ?? 0)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {best && worst && best.channel !== worst.channel ? (
              <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-base text-steel">
                <span className="inline-flex items-center gap-1.5">
                  <TrendingDown size={15} className="text-moss" aria-hidden />
                  {t("cheapest", { channel: channelName(best.channel), czk: money(best.costPerHireCzk ?? 0) })}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <TrendingUp size={15} className="text-coral" aria-hidden />
                  {t("dearest", { channel: channelName(worst.channel), czk: money(worst.costPerHireCzk ?? 0) })}
                </span>
              </p>
            ) : null}
          </>
        )}

        {/* Spend is the input the whole axis rests on, so editing it lives here
            rather than three panels away. */}
        <div className="mt-5 border-t border-stone-200 pt-4">
          <p className="text-meta uppercase text-steel">{t("spendTitle")}</p>
          <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
            {data.byChannel.map((r) => (
              <li key={r.channel} className="flex items-center gap-2 text-base">
                <span className="text-steel">{channelName(r.channel)}</span>
                <SpendInput channel={r.channel} channelLabel={channelName(r.channel)} value={r.spendCzk} onSaved={reload} />
              </li>
            ))}
          </ul>
        </div>
      </section>

      <Defer strategy="idle">
        <SourcePanel
          rows={data.bySource}
          deltas={data.deltas?.bySource ?? null}
          channelsHref={buildUrl({ ...clearedTabScopedParams(), tab: "channels" }, tabScopedSearch)}
        />
      </Defer>

      <Defer strategy="visible">
        <ComputeCostPanel
          computeCost={data.computeCost}
          costPerHireCzk={data.costPerHireCzk}
          hired={data.hired}
          windowed={windowed}
        />
      </Defer>
    </div>
  );
}
