"use client";

// VARIANT A — "Flight deck". Metaphor: an instrument panel you monitor.
//
// The baseline is a column of cards you scroll through, so "is anything wrong?"
// costs a full read of the page. The deck answers it in one glance instead:
// every number sits at a fixed station, each carries its target as a marker
// rather than as a separate goal chip, and anything off-target reports itself in
// a dedicated attention rail instead of waiting to be noticed inside a chart.
//
// What differs from baseline, structurally:
//   • the funnel runs HORIZONTALLY as a flow (stage → drop → stage), because a
//     funnel is a sequence and the vertical bar list renders it as a ranking;
//   • the vitals strip shows target deviation, not raw values alone;
//   • an attention rail computes what's wrong, instead of the reader deriving it;
//   • nothing below the fold is primary — the deck fits a screen.
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import { forecastHires } from "@/app/_lib/analytics-forecast";
import { PANEL } from "@/app/_components/ui/recipes";
import { Defer } from "@/app/_components/ui/Defer";
import { DeltaChip } from "../AnalyticsDeltaChip";
import { MomentumPanel, OrgBenchmarkPanel } from "./sectionChunks";
import { AnalyticsByRoleTable } from "../AnalyticsByRoleTable";
import { DeckVital, DeckFlow, type DeckAlert } from "./FlightDeckParts";
import type { PerformanceProps } from "./performanceTypes";

export function PerformanceFlightDeck({
  data,
  enumLabel,
  convDeltaByStage,
  boardHref,
  reload,
}: PerformanceProps) {
  const t = useTranslations("analytics");
  const forecast = forecastHires({
    weeklyAdded: data.momentum.map((w) => w.added),
    funnel: data.funnel.map((r) => ({ stage: r.stage, reached: r.reached, current: r.current })),
    avgTimeToHireDays: data.avgTimeToHireDays,
    offerAcceptRate: data.offers.acceptRate,
  });

  // The attention rail. Derived here rather than read off the payload: these are
  // exactly the conditions the baseline renders SOMEWHERE (a coral percentage in
  // the funnel, an amber bottleneck banner, a missed goal chip) and asks the
  // reader to find. Collecting them is the variant's whole thesis.
  const alerts: DeckAlert[] = [];
  if (data.bottleneck) {
    alerts.push({
      key: "bottleneck",
      tone: "caution",
      text: t("bottleneckPlain", {
        count: data.bottleneck.entryCount,
        stage: enumLabel("stage", data.bottleneck.stage),
        days: data.bottleneck.avgDaysInStage,
      }),
      href: boardHref({ stage: data.bottleneck.stage }),
    });
  }
  for (const f of data.funnel) {
    const goal = data.targets.conversion[f.stage];
    if (goal != null && f.conversionPct != null && f.conversionPct < goal) {
      alerts.push({
        key: `conv-${f.stage}`,
        tone: "critical",
        text: `${enumLabel("stage", f.stage)} converting at ${f.conversionPct}% against a ${goal}% goal`,
        href: boardHref({ stage: f.stage }),
      });
    }
  }
  if (data.targets.timeToHireDays != null && data.avgTimeToHireDays != null && data.avgTimeToHireDays > data.targets.timeToHireDays) {
    alerts.push({
      key: "tth",
      tone: "critical",
      text: `Time to hire is ${data.avgTimeToHireDays} days against a ${data.targets.timeToHireDays}-day goal`,
    });
  }

  return (
    <div className="space-y-5">
      {/* ---- Vitals strip: every headline figure at a fixed station ---------- */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-stone-200 bg-stone-200 shadow-panel sm:grid-cols-3 xl:grid-cols-6">
        <DeckVital label={t("statCandidates")} value={data.total} sub={t("activeSub", { count: data.active })} delta={data.deltas?.total} />
        <DeckVital label={t("statHired")} value={data.hired} sub={t("statHiredOfTotal", { total: data.total })} delta={data.deltas?.hireRatePct} unit="pts" />
        <DeckVital
          label={t("statTimeToHire")}
          value={data.avgTimeToHireDays ?? "—"}
          sub={data.avgTimeToHireDays != null ? t("daysAvg") : t("noHires")}
          delta={data.deltas?.avgTimeToHireDays}
          unit="days"
          lowerIsBetter
          target={data.targets.timeToHireDays}
          actual={data.avgTimeToHireDays}
        />
        <DeckVital label={t("statAge")} value={data.avgAgeDays ?? "—"} sub={data.avgAgeDays != null ? t("daysActive") : undefined} />
        <DeckVital label={t("forecast.inFlight")} value={forecast.hasSignal ? forecast.inFlightExpectedHires : "—"} sub={t("deckExpectedHires")} tone="moss" />
        <DeckVital label={t("deckVelocity")} value={forecast.hasSignal ? forecast.weeklyVelocity : "—"} sub={t("deckPerWeek")} />
      </div>

      {/* ---- Flow + attention: the two things a monitor actually watches ----- */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <DeckFlow
          funnel={data.funnel}
          targets={data.targets}
          convDeltaByStage={convDeltaByStage}
          enumLabel={enumLabel}
          boardHref={boardHref}
          koDeclined={data.koDeclined}
          empty={data.total === 0}
          onGoalsSaved={reload}
        />

        <div className={`${PANEL} flex flex-col p-4`}>
          <h3 className="font-serif text-h2 text-ink">{t("deckAttention")}</h3>
          {alerts.length === 0 ? (
            <div className="mt-3 flex flex-1 flex-col items-center justify-center gap-2 rounded-md bg-paper/60 p-6 text-center">
              <CheckCircle2 size={20} className="text-moss" aria-hidden />
              <p className="text-base text-steel">{t("deckAllClear")}</p>
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {alerts.map((a) => {
                const body = (
                  <span className="flex items-start gap-2">
                    <AlertTriangle
                      size={14}
                      className={`mt-1 shrink-0 ${a.tone === "critical" ? "text-coral" : "text-dial-amber"}`}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 text-base leading-snug text-ink">{a.text}</span>
                    {a.href ? <ArrowRight size={14} className="mt-1 shrink-0 text-steel" aria-hidden /> : null}
                  </span>
                );
                return (
                  <li key={a.key}>
                    {a.href ? (
                      <Link
                        href={a.href}
                        className={`focus-ring block rounded-md border px-3 py-2 transition-colors hover:bg-paper ${
                          a.tone === "critical" ? "border-coral/30 bg-coral/5" : "border-dial-amber/40 bg-dial-amber/10"
                        }`}
                      >
                        {body}
                      </Link>
                    ) : (
                      <div
                        className={`rounded-md border px-3 py-2 ${
                          a.tone === "critical" ? "border-coral/30 bg-coral/5" : "border-dial-amber/40 bg-dial-amber/10"
                        }`}
                      >
                        {body}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* The forecast lives here, not in its own card: on a deck, "what is
              coming" is a readout, not a chapter. */}
          {forecast.hasSignal ? (
            <dl className="mt-4 space-y-1.5 border-t border-stone-200 pt-3">
              {forecast.projected.map((p) => (
                <div key={p.weeks} className="flex items-baseline justify-between gap-2">
                  <dt className="text-base text-steel">{t("forecast.horizon", { weeks: p.weeks })}</dt>
                  <dd className="text-base font-semibold text-ink nums">{t("forecast.plusHires", { hires: p.hires })}</dd>
                </div>
              ))}
              {data.deltas?.total ? (
                <div className="flex items-baseline justify-between gap-2 pt-1">
                  <dt className="text-meta uppercase text-steel">{t("deckVsPrior")}</dt>
                  <dd><DeltaChip delta={data.deltas.total} /></dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>
      </div>

      {/* ---- Secondary instruments, below the primary read ------------------- */}
      <Defer strategy="next-frame">
        <MomentumPanel weeks={data.momentum} />
      </Defer>
      <Defer strategy="idle">
        <OrgBenchmarkPanel />
      </Defer>
      <Defer strategy="visible">
        <AnalyticsByRoleTable data={data} boardHref={boardHref} />
      </Defer>
    </div>
  );
}
