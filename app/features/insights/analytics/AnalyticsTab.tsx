"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { buildUrl, clearedTabScopedParams } from "@/app/features/shell/tabs";
import { Defer } from "@/app/_components/ui/Defer";
import { AnalyticsHeader } from "./AnalyticsHeader";
import { AnalyticsMainGrid } from "./AnalyticsMainGrid";
import { AnalyticsByRoleTable } from "./AnalyticsByRoleTable";
import {
  MomentumPanel,
  OrgBenchmarkPanel,
  CalibrationPanel,
  DecisionRecordsPanel,
  ChannelEconomicsPanel,
  ComputeCostPanel,
  DecisionLog,
} from "./AnalyticsTabChunks";
import type { Analytics } from "./AnalyticsTypes";

// Re-exported for the split-out panels/tests that still import these two
// primitives (DeltaChip, InlineNumberSave) via "./AnalyticsTab" — the tab
// entry component's filename is pinned (the shell dynamic-imports it), so
// these barrel re-exports keep those call sites unchanged while the actual
// implementations live in their own modules.
export { DeltaChip } from "./AnalyticsDeltaChip";
export { InlineNumberSave } from "./AnalyticsInlineNumberSave";
export type { Analytics } from "./AnalyticsTypes";

export function AnalyticsTab() {
  const t = useTranslations("analytics");
  const enumLabel = useEnumLabel();
  const search = useSearchParams();
  // Review-only: see the funnel zero state on any workspace (see the branch below).
  const forceFunnelEmpty = search.get("funnelEmpty") === "1";
  const router = useRouter();
  // ANA2 — cohort window. Changing it swaps the fetch URL; useJsonFetch refires
  // on the change (prior data stays visible until the new payload lands).
  // Held in the URL (?win=30|90; absent = all time), NOT component state: a
  // round-trip to the board and back — or a shared/bookmarked link — keeps the
  // same cohort. Deliberately not tab-scoped (it's a view preference, not a
  // selection), so it survives a bare tab switch. router.replace mirrors the
  // board's PIPE3 filter write-back (no history spam).
  const winParam = search.get("win");
  const days: number | null = winParam === "30" ? 30 : winParam === "90" ? 90 : null;
  const setDays = (w: number | null) =>
    router.replace(buildUrl({ win: w ? String(w) : null }, search.toString()), { scroll: false });
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

  // ce8e3c9e — index the per-stage conversion deltas by stage for the funnel render.
  // Guarded (data may still be null): computed once here instead of duplicated at
  // each of the two call sites below.
  const maxReached = data ? Math.max(1, ...data.funnel.map((f) => f.reached)) : 1;
  const convDeltaByStage = new Map((data?.deltas?.funnel ?? []).map((f) => [f.stage, f.conversionPct]));

  return (
    // Tier 1 (docs/design/loading-choreography.md): the header + window switcher render
    // on the first frame regardless of the fetch; aria-busy covers the initial
    // load only — a later refresh (window switch, reload()) never blanks what's
    // already on screen.
    <section className="stagger-children space-y-6" aria-busy={!data && !error}>
      <AnalyticsHeader data={data} error={error} days={days} setDays={setDays} />

      {/* Tier 2: the error affordance the tab already used, now nested under the
          always-rendering header instead of replacing the whole tab. */}
      {error ? (
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
      ) : null}

      {/* Tier 2: the primary funnel/forecast/archetype/automation/source grid —
          the tab's main event. Hold its height while the fetch is in flight
          (reveal-quiet: invisible for 150ms so a fast response paints nothing),
          then fade the real content in place once it lands. A later refresh
          re-renders this same branch silently — data already on screen is never
          blanked because `data` stays non-null across a reload(). */}
      {!data && !error ? (
        <div className="reveal-quiet min-h-[28rem]" aria-hidden />
      ) : data ? (
        <AnalyticsMainGrid
          data={data}
          enumLabel={enumLabel}
          maxReached={maxReached}
          convDeltaByStage={convDeltaByStage}
          boardHref={boardHref}
          forceFunnelEmpty={forceFunnelEmpty}
          reload={reload}
          tabScopedSearch={search.toString()}
        />
      ) : null}

      {/* Tier 3 (docs/design/loading-choreography.md): MomentumPanel is just below the
          primary grid — its own chunk, one frame later so it never competes with
          the funnel/forecast paint. */}
      {data ? (
        <Defer strategy="next-frame">
          <MomentumPanel weeks={data.momentum} />
        </Defer>
      ) : null}

      {/* Tier 3: each of these runs its OWN fetch, independent of the main
          analytics payload — never held on a sibling (law 4). They mount an idle
          beat later purely so their charts/tables don't all commit on one frame. */}
      <Defer strategy="idle">
        <OrgBenchmarkPanel />
      </Defer>

      <Defer strategy="idle">
        <CalibrationPanel />
      </Defer>

      <Defer strategy="idle">
        <DecisionRecordsPanel />
      </Defer>

      {/* Tier 3: heavy, data-dependent, below-the-fold tables — deferred until
          scrolled near (strategy="visible"); most sessions never build them. */}
      {data ? (
        <Defer strategy="visible">
          <ChannelEconomicsPanel
            rows={data.byChannel}
            deltas={data.deltas?.byChannel ?? null}
            variants={data.byVariant}
            variantTotal={data.byVariantTotal}
            recommendations={data.variantRecommendations}
            onSpendSaved={reload}
            windowed={data.windowDays != null}
          />
        </Defer>
      ) : null}

      {data ? (
        <Defer strategy="visible">
          <ComputeCostPanel
            computeCost={data.computeCost}
            costPerHireCzk={data.costPerHireCzk}
            hired={data.hired}
            windowed={data.windowDays != null}
          />
        </Defer>
      ) : null}

      {data ? (
        <Defer strategy="visible">
          <AnalyticsByRoleTable data={data} boardHref={boardHref} />
        </Defer>
      ) : null}

      {/* Tier 3: the paged decision log — its own fetch (useInfiniteScroll), own
          chunk, deferred until scrolled near like the tables above it. */}
      <Defer strategy="visible">
        <DecisionLog />
      </Defer>
    </section>
  );
}
