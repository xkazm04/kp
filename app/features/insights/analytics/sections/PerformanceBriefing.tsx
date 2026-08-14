"use client";

// VARIANT B — "Briefing". Metaphor: the weekly hiring brief a good analyst would
// have written for you.
//
// The baseline (and the deck) both present numbers and leave the reading to you.
// This one takes a position: every band opens with a CLAIM in display type, and
// the chart underneath is the evidence for that claim rather than the point of
// the band. If the data can't support a claim, the band says so plainly instead
// of rendering an inconclusive chart.
//
// What differs, structurally:
//   • a computed lede sentence, not a stat grid — the single most important fact
//     is chosen here rather than left for the reader to spot among six tiles;
//   • one idea per full-width band, vertical rhythm, no side-by-side grid;
//   • charts are stripped of card chrome — they're figures inside prose, and a
//     figure doesn't need its own border;
//   • copy voice is the product's ("no robots in charge"), not a dashboard's.
import Link from "next/link";
import { useTranslations } from "next-intl";
import { forecastHires } from "@/app/_lib/analytics-forecast";
import { Defer } from "@/app/_components/ui/Defer";
import { SectionTitle } from "@/app/_components/ui/SectionTitle";
import { EYEBROW } from "@/app/_components/ui/recipes";
import { DeltaChip } from "../AnalyticsDeltaChip";
import { GoalsEditor } from "../AnalyticsGoalsEditor";
import { AnalyticsByRoleTable } from "../AnalyticsByRoleTable";
import { MomentumPanel, OrgBenchmarkPanel } from "./sectionChunks";
import type { PerformanceProps } from "./performanceTypes";

/** One band of the brief: eyebrow, claim, context sentence, then the evidence. */
function Band({
  eyebrow,
  claim,
  context,
  children,
}: {
  eyebrow: string;
  claim: string;
  context?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="border-t border-stone-200 pt-6">
      <p className={EYEBROW}>{eyebrow}</p>
      <SectionTitle className="mt-1 max-w-3xl !text-h1">{claim}</SectionTitle>
      {context ? <p className="mt-3 max-w-2xl text-body leading-relaxed text-steel">{context}</p> : null}
      {children ? <div className="mt-5">{children}</div> : null}
    </section>
  );
}

export function PerformanceBriefing({ data, enumLabel, maxReached, convDeltaByStage, boardHref, reload }: PerformanceProps) {
  const t = useTranslations("analytics");
  const forecast = forecastHires({
    weeklyAdded: data.momentum.map((w) => w.added),
    funnel: data.funnel.map((r) => ({ stage: r.stage, reached: r.reached, current: r.current })),
    avgTimeToHireDays: data.avgTimeToHireDays,
    offerAcceptRate: data.offers.acceptRate,
  });

  // The stage furthest below its goal — the brief's lead story when there is one.
  const worst = data.funnel
    .filter((f) => f.conversionPct != null)
    .map((f) => ({ f, gap: (data.targets.conversion[f.stage] ?? 50) - f.conversionPct! }))
    .filter((x) => x.gap > 0)
    .sort((a, b) => b.gap - a.gap)[0];

  return (
    <article className="space-y-6">
      {/* ---- The lede: the one sentence, in the product's voice --------------- */}
      <header>
        <p className={EYEBROW}>{t("briefEyebrow")}</p>
        <p className="mt-2 max-w-4xl font-serif text-display leading-tight text-ink">
          {t.rich("briefLede", {
            total: data.total,
            active: data.active,
            hired: data.hired,
            n: (chunks) => <span className="text-coral">{chunks}</span>,
          })}
        </p>
        <p className="mt-3 max-w-2xl text-body leading-relaxed text-steel">
          {data.avgTimeToHireDays != null
            ? t("briefTthLine", { days: data.avgTimeToHireDays })
            : t("briefNoHiresLine")}
          {data.targets.timeToHireDays != null && data.avgTimeToHireDays != null
            ? ` ${
                data.avgTimeToHireDays > data.targets.timeToHireDays
                  ? t("briefTthOver", { goal: data.targets.timeToHireDays, over: data.avgTimeToHireDays - data.targets.timeToHireDays })
                  : t("briefTthUnder", { goal: data.targets.timeToHireDays })
              }`
            : ""}
        </p>
        {data.deltas?.total || data.deltas?.hireRatePct ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-steel">
            {data.deltas?.total ? (
              <span className="inline-flex items-center gap-1.5">
                {t("statCandidates")} <DeltaChip delta={data.deltas.total} />
              </span>
            ) : null}
            {data.deltas?.hireRatePct ? (
              <span className="inline-flex items-center gap-1.5">
                {t("statHired")} <DeltaChip delta={data.deltas.hireRatePct} unit="pts" />
              </span>
            ) : null}
          </div>
        ) : null}
      </header>

      {/* ---- Band 1: where it stalls ---------------------------------------- */}
      <Band
        eyebrow={t("briefBandFunnel")}
        claim={
          data.total === 0
            ? t("briefNoDataClaim")
            : data.bottleneck
              ? t("briefStallClaim", { stage: enumLabel("stage", data.bottleneck.stage), days: data.bottleneck.avgDaysInStage })
              : worst
                ? t("briefWeakestClaim", { stage: enumLabel("stage", worst.f.stage), pct: worst.f.conversionPct! })
                : t("briefFunnelHealthyClaim")
        }
        context={
          data.total === 0
            ? t("briefNoDataContext")
            : data.bottleneck
              ? t("briefStallContext", { count: data.bottleneck.entryCount })
              : undefined
        }
      >
        {data.total === 0 ? null : (
          <>
            <ul className="max-w-3xl space-y-2">
              {data.funnel.map((f) => {
                const goal = data.targets.conversion[f.stage] ?? 50;
                const missed = f.conversionPct != null && f.conversionPct < goal;
                return (
                  <li key={f.stage}>
                    <Link
                      href={boardHref({ stage: f.stage })}
                      title={t("viewInBoard")}
                      className="focus-ring -mx-1.5 flex items-center gap-4 rounded-md px-1.5 py-1 hover:bg-paper/70"
                    >
                      <span className="w-28 shrink-0 text-base font-medium text-ink">{enumLabel("stage", f.stage)}</span>
                      {/* A hairline rule, not a filled bar: in a brief the chart
                          is a figure in the margin, not the headline. */}
                      <span className="relative h-px flex-1 bg-stone-200">
                        <span
                          className={`absolute inset-y-0 left-0 -top-[2px] h-[5px] rounded-full ${missed ? "bg-coral" : "bg-moss"}`}
                          style={{ width: `${Math.max(2, Math.round((f.reached / maxReached) * 100))}%` }}
                          aria-hidden
                        />
                      </span>
                      <span className="w-16 shrink-0 text-right text-base text-ink nums">{f.reached}</span>
                      <span className="flex w-24 shrink-0 items-center justify-end gap-1.5 text-base nums">
                        {f.conversionPct != null ? (
                          <span className={missed ? "text-coral" : "text-moss"}>{f.conversionPct}%</span>
                        ) : (
                          <span className="text-steel">—</span>
                        )}
                        {convDeltaByStage.get(f.stage) ? <DeltaChip delta={convDeltaByStage.get(f.stage)!} unit="pts" /> : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="max-w-3xl">
              <GoalsEditor
                stages={data.funnel.map((f) => f.stage)}
                conversion={data.targets.conversion}
                timeToHireDays={data.targets.timeToHireDays}
                onSaved={reload}
              />
            </div>
          </>
        )}
      </Band>

      {/* ---- Band 2: what's coming ------------------------------------------ */}
      <Band
        eyebrow={t("briefBandForecast")}
        claim={
          forecast.hasSignal
            ? t("briefForecastClaim", { hires: forecast.inFlightExpectedHires })
            : t("briefForecastNoSignalClaim")
        }
        context={
          forecast.hasSignal
            ? t("briefForecastContext", { velocity: forecast.weeklyVelocity, conv: forecast.overallConversionPct ?? 0 })
            : t("briefForecastNoSignalContext")
        }
      >
        {forecast.hasSignal ? (
          <dl className="flex max-w-3xl flex-wrap gap-x-10 gap-y-3">
            {forecast.projected.map((p) => (
              <div key={p.weeks} className="flex flex-col gap-0.5">
                <dt className="text-meta uppercase text-steel">{t("forecast.horizon", { weeks: p.weeks })}</dt>
                <dd className="font-serif text-h2 leading-none text-ink nums">{t("forecast.plusHires", { hires: p.hires })}</dd>
              </div>
            ))}
            {forecast.etaDays != null ? (
              <div className="flex flex-col gap-0.5">
                <dt className="text-meta uppercase text-steel">{t("briefEtaLabel")}</dt>
                <dd className="font-serif text-h2 leading-none text-steel nums">{t("briefEtaValue", { days: forecast.etaDays })}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </Band>

      {/* ---- Band 3: how the weeks moved ------------------------------------ */}
      <Band eyebrow={t("briefBandMomentum")} claim={t("briefMomentumClaim")}>
        <Defer strategy="next-frame">
          <MomentumPanel weeks={data.momentum} />
        </Defer>
      </Band>

      {/* ---- Band 4: which roles carry it ----------------------------------- */}
      <Band eyebrow={t("briefBandRoles")} claim={t("briefRolesClaim")}>
        <Defer strategy="visible">
          <AnalyticsByRoleTable data={data} boardHref={boardHref} />
        </Defer>
        <div className="mt-6">
          <Defer strategy="idle">
            <OrgBenchmarkPanel />
          </Defer>
        </div>
      </Band>
    </article>
  );
}
