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
import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { forecastHires } from "@/app/_lib/analytics-forecast";
import { Defer } from "@/app/_components/ui/Defer";
import { SectionTitle } from "@/app/_components/ui/SectionTitle";
import { EYEBROW } from "@/app/_components/ui/recipes";
import { DeltaChip } from "../AnalyticsDeltaChip";
import { GoalsEditor } from "../AnalyticsGoalsEditor";
import { AnalyticsByRoleTable } from "../AnalyticsByRoleTable";
import { FunnelEmptyGuide } from "../AnalyticsFunnelEmptyGuide";
import { funnelBandState, hasUngoaledStage, stageVerdict } from "../analyticsFunnelEmptyState";
import { StageDwellPanel } from "../AnalyticsStageDwellPanel";
import { AnalyticsArchetypePanel } from "../AnalyticsArchetypePanel";
import { MomentumPanel, OrgBenchmarkPanel } from "./sectionChunks";
import { BAND_NO_DATA_CLAIMS, hasRoleRows, momentumIsQuiet, type BandKey } from "../performanceBands";
import type { PerformanceProps } from "./performanceTypes";

/** One band of the brief: eyebrow, claim, context sentence, then the evidence.
 *
 *  UAT TOM-ANA-12 — the claim is CONDITIONAL by construction. Two bands used to
 *  resolve their own no-data sentence in the `claim` expression and two simply did
 *  not, which is why the empty tenant read „Které role táhnou pipeline." above the
 *  first-run hero. Now the fallback is looked up from the band's key, so writing a
 *  band without one is not a thing this component can be asked to do. */
function Band({
  bandKey,
  eyebrow,
  claim,
  hasData,
  context,
  noDataContext,
  children,
}: {
  /** Which band this is. Resolves the no-data claim from BAND_NO_DATA_CLAIMS —
   *  a total table, so the key and the fallback cannot come apart. */
  bandKey: BandKey;
  eyebrow: string;
  /** What the band is entitled to assert WHEN its evidence exists. */
  claim: string;
  /** Does this band's own evidence exist? Not "is the payload loaded" — the same
   *  condition the panel underneath uses for its zero state, so a display-type
   *  heading can never contradict the figure it introduces. */
  hasData: boolean;
  context?: string;
  /** Optional supporting sentence for the no-data state. Omitted where the panel
   *  below already carries its own body copy: saying it twice is just louder. */
  noDataContext?: string;
  children?: React.ReactNode;
}) {
  const t = useTranslations("analytics");
  return (
    <section className="border-t border-stone-200 pt-6">
      <p className={EYEBROW}>{eyebrow}</p>
      {/* No max-width on the claim. A band header is one short sentence and the
          measure that keeps BODY copy readable was breaking it onto a second row
          while most of the row sat empty — a two-line heading reads as two ideas.
          `text-balance` splits the rare genuinely-long claim evenly instead of
          leaving one orphaned word below. Context and evidence below keep their
          reading measure; only the heading is released from it. */}
      <SectionTitle className="mt-1 text-balance !text-h1">
        {hasData ? claim : t(BAND_NO_DATA_CLAIMS[bandKey])}
      </SectionTitle>
      {(hasData ? context : noDataContext) ? (
        <p className="mt-3 max-w-2xl text-body leading-relaxed text-steel">{hasData ? context : noDataContext}</p>
      ) : null}
      {/* The evidence keeps rendering either way. Each panel below owns an honest
          zero state of its own (momentumEmpty, AnalyticsEmptyPreview — the tab's
          whole first-run hero, with its two CTAs), and suppressing them to "fix"
          the heading would take away the one thing an empty workspace needs. */}
      {children ? <div className="mt-5">{children}</div> : null}
    </section>
  );
}

export function PerformanceBriefing({ data, enumLabel, maxReached, convDeltaByStage, boardHref, reload }: PerformanceProps) {
  const t = useTranslations("analytics");
  // UAT TOM-ANA-9 — the no-goal note needs to open the editor two bands down in
  // one click, so the editor's disclosure state is lifted here.
  const [goalsOpen, setGoalsOpen] = useState(false);
  const forecast = forecastHires({
    weeklyAdded: data.momentum.map((w) => w.added),
    funnel: data.funnel.map((r) => ({ stage: r.stage, reached: r.reached, current: r.current })),
    avgTimeToHireDays: data.avgTimeToHireDays,
    offerAcceptRate: data.offers.acceptRate,
  });

  // UAT TOM-ANA-3 + TOM-ANA-9 — which claim this band is entitled to make is now a
  // value, resolved in `analyticsFunnelEmptyState` and pinned by a test against a
  // real analytics payload. Two branches are new here and both are refusals:
  // `no-movement` (conversion measures hand-offs, and with none of them a 0 % means
  // "not yet", not "we lose everyone here" — the guard and its four locales already
  // existed, they were just off the render path) and `no-goal` (a colour is a
  // judgement, and the `?? 50` it used to be judged against was a number nobody in
  // the org ever set).
  const band = funnelBandState({
    total: data.total,
    funnel: data.funnel,
    goals: data.targets.conversion,
    hasBottleneck: data.bottleneck != null,
  });
  // At least one stage shows a real conversion number that no goal can judge —
  // the condition the grey rows below need explained.
  const showNoGoalNote =
    band.kind !== "no-data" && band.kind !== "no-movement" && hasUngoaledStage(data.funnel, data.targets.conversion);

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
        {/* Gate on the DELTA, not on the Delta object. `data.deltas.hireRatePct` is a
            record that always exists in a windowed view, but its `delta` is null
            whenever a baseline cannot be formed (a prior window with no candidates has
            no hire rate — `analytics-deltas.ts` returns null rather than 0 %), and
            DeltaChip correctly renders nothing for it. Keyed off the object, the label
            rendered anyway: a young workspace on a 30-day window got a bare "Hired"
            with empty space where its number belongs. */}
        {data.deltas?.total.delta != null || data.deltas?.hireRatePct.delta != null ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-steel">
            {data.deltas?.total.delta != null ? (
              <span className="inline-flex items-center gap-1.5">
                {t("statCandidates")} <DeltaChip delta={data.deltas.total} />
              </span>
            ) : null}
            {data.deltas?.hireRatePct.delta != null ? (
              <span className="inline-flex items-center gap-1.5">
                {t("statHired")} <DeltaChip delta={data.deltas.hireRatePct} unit="pts" />
              </span>
            ) : null}
          </div>
        ) : null}
      </header>

      {/* ---- Band 1: where it stalls ---------------------------------------- */}
      <Band
        bandKey="funnel"
        eyebrow={t("briefBandFunnel")}
        // `no-data` no longer branches inside the claim: it IS the no-data state,
        // and Band resolves briefNoDataClaim from the band key.
        hasData={band.kind !== "no-data"}
        noDataContext={t("briefNoDataContext")}
        claim={
          band.kind === "no-movement"
            ? // The sentence that was already written and translated for exactly
              // this state — „Nábor je připravený a čeká".
              t("funnelGuide.title")
            : band.kind === "stalled"
              ? t("briefStallClaim", { stage: enumLabel("stage", data.bottleneck!.stage), days: data.bottleneck!.avgDaysInStage })
              : band.kind === "weakest"
                ? // The goal is named IN the claim: a verdict that hides its own
                  // benchmark is the defect TOM-ANA-9 reported.
                  t("briefWeakestGoalClaim", {
                    stage: enumLabel("stage", band.link.stage),
                    pct: band.link.conversionPct,
                    goal: band.link.goal,
                  })
                : band.kind === "no-goal"
                  ? t("briefNoGoalClaim")
                  : t("briefFunnelHealthyClaim")
        }
        context={
          band.kind === "stalled"
            ? t("briefStallContext", { count: data.bottleneck!.entryCount })
            : // `no-movement` says nothing here: the guide below carries its own
              // body copy and saying it twice would just be louder.
              undefined
        }
      >
        {band.kind === "no-data" ? null : band.kind === "no-movement" ? (
          <FunnelEmptyGuide
            funnel={data.funnel}
            stageLabel={(stage) => enumLabel("stage", stage)}
            links={[{ tab: "pipeline", label: t("openPipelineBoard") }]}
          />
        ) : (
          <>
            <ul className="max-w-3xl space-y-2">
              {data.funnel.map((f) => {
                // UAT TOM-ANA-9 — three states, not two. `none` is what a stage
                // wears when the org set no goal: the number is still shown, the
                // judgement is withheld. Coral against an invented benchmark is
                // the thing that made a reader distrust the whole band.
                const goal = data.targets.conversion[f.stage];
                const verdict = stageVerdict(f.conversionPct, goal);
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
                          className={`absolute inset-y-0 left-0 -top-[2px] h-[5px] rounded-full ${
                            verdict === "missed" ? "bg-coral" : verdict === "met" ? "bg-moss" : "bg-stone-400"
                          }`}
                          style={{ width: `${Math.max(2, Math.round((f.reached / maxReached) * 100))}%` }}
                          aria-hidden
                        />
                      </span>
                      <span className="w-16 shrink-0 text-right text-base text-ink nums">{f.reached}</span>
                      <span className="flex w-28 shrink-0 flex-col items-end text-base nums">
                        <span className="flex items-center gap-1.5">
                          {f.conversionPct != null ? (
                            <span
                              className={
                                verdict === "missed" ? "text-coral" : verdict === "met" ? "text-moss" : "text-ink"
                              }
                            >
                              {f.conversionPct}%
                            </span>
                          ) : (
                            <span className="text-steel">—</span>
                          )}
                          {convDeltaByStage.get(f.stage) ? <DeltaChip delta={convDeltaByStage.get(f.stage)!} unit="pts" /> : null}
                        </span>
                        {/* The benchmark rides beside the colour it licenses — the
                            goal chip the pre-consolidation panel showed, and only
                            ever when a goal was actually set. */}
                        {goal != null ? <span className="text-meta text-steel">{t("goalPct", { pct: goal })}</span> : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="max-w-3xl">
              {/* UAT TOM-ANA-9 — the grey rows explain themselves, and the
                  explanation is the way to change them. Disclosure without a
                  one-click path would just be a longer apology. */}
              {showNoGoalNote ? (
                <p className="mt-4 max-w-2xl text-sm leading-relaxed text-steel">
                  {t("briefNoGoalNote")}{" "}
                  <button
                    type="button"
                    onClick={() => setGoalsOpen(true)}
                    className="focus-ring rounded font-semibold text-coral underline-offset-2 hover:underline"
                  >
                    {t("briefSetGoals")}
                  </button>
                </p>
              ) : null}
              <GoalsEditor
                stages={data.funnel.map((f) => f.stage)}
                conversion={data.targets.conversion}
                timeToHireDays={data.targets.timeToHireDays}
                onSaved={reload}
                open={goalsOpen}
                onOpenChange={setGoalsOpen}
              />
            </div>
          </>
        )}
      </Band>

      {/* UAT KAT-ANA-3 / TOM-ANA-2 — per-stage dwell is the literal answer to
          "why is my role still open", and the server computed it on every request
          with no renderer from the consolidation until now. Placed directly under
          the funnel band because it explains the number above it. */}
      <StageDwellPanel
        stageDwell={data.stageDwell}
        koDeclined={data.koDeclined}
        offers={data.offers}
        enumLabel={enumLabel}
        boardHref={boardHref}
      />

      {/* ---- Band 2: what's coming ------------------------------------------ */}
      <Band
        bandKey="forecast"
        eyebrow={t("briefBandForecast")}
        hasData={forecast.hasSignal}
        claim={t("briefForecastClaim", { hires: forecast.inFlightExpectedHires })}
        context={t("briefForecastContext", { velocity: forecast.weeklyVelocity, conv: forecast.overallConversionPct ?? 0 })}
        noDataContext={t("briefForecastNoSignalContext")}
      >
        {forecast.hasSignal ? (
          <>
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
            {/* The projection's OTHER assumption, stated where the figures are read.
                When an observed offer-accept rate applies, `forecastHires` rebuilds the
                offer→hire leg as (reach → offer) × that rate — so the numbers above are
                NOT `overallConversionPct`, which is the only basis the context sentence
                above names. On a 100 → 20 offers → 10 hires funnel with an observed 83 %
                acceptance the horizons render from 16.6 %, while the sentence says
                "10 % overall conversion": the stated basis could not produce the stated
                projection, and the substituted leg was invisible. `offerAcceptRate` is
                exported by the forecast for exactly this ("lets the UI state its
                acceptance basis honestly") and `forecast.acceptBasis` was already
                written in all four locales with no caller. */}
            {forecast.offerAcceptRate != null ? (
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-steel">
                {t("forecast.acceptBasis", { pct: Math.round(forecast.offerAcceptRate * 100), n: data.offers.n })}
              </p>
            ) : null}
          </>
        ) : null}
      </Band>

      {/* ---- Band 3: how the weeks moved ------------------------------------ */}
      {/* UAT TOM-ANA-12 — `momentumIsQuiet` is the SAME predicate MomentumPanel uses
          to choose its quiet branch, so „Jak se hýbaly poslední týdny." can no longer
          stand above „V tomto období zatím žádná aktivita v pipeline." */}
      <Band
        bandKey="momentum"
        eyebrow={t("briefBandMomentum")}
        hasData={!momentumIsQuiet(data.momentum)}
        claim={t("briefMomentumClaim")}
      >
        <Defer strategy="next-frame">
          <MomentumPanel weeks={data.momentum} />
        </Defer>
      </Band>

      {/* ---- Band 4: which roles carry it ----------------------------------- */}
      {/* UAT TOM-ANA-12 — same pairing: `hasRoleRows` is what AnalyticsByRoleTable
          checks before it renders the tab's first-run hero instead of rows, so the
          heading cannot claim roles are carrying anything above an empty table. */}
      <Band
        bandKey="roles"
        eyebrow={t("briefBandRoles")}
        hasData={hasRoleRows(data.byJob)}
        claim={t("briefRolesClaim")}
      >
        <Defer strategy="visible">
          <AnalyticsByRoleTable data={data} boardHref={boardHref} />
        </Defer>
        <div className="mt-6">
          <Defer strategy="idle">
            <OrgBenchmarkPanel />
          </Defer>
        </div>
        {/* UAT KAT-ANA-3 — byArchetype was computed and rendered nowhere. */}
        <div className="mt-6">
          <Defer strategy="idle">
            <AnalyticsArchetypePanel byArchetype={data.byArchetype} />
          </Defer>
        </div>
      </Band>
    </article>
  );
}
