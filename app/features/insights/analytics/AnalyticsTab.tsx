"use client";

import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { buildUrl, clearedTabScopedParams } from "@/app/features/shell/tabs";
import { useUrlInboxState } from "@/app/features/shell/nav/useUrlInboxState";
import { AnalyticsHeader } from "./AnalyticsHeader";
import { AnalyticsSectionNav } from "./sections/AnalyticsSectionNav";
import { isAnalyticsSectionId, resolveAnalyticsSection, type AnalyticsSectionId } from "./sections/analyticsSections";
import type { Analytics } from "./AnalyticsTypes";

// Re-exported for the split-out panels/tests that still import these two
// primitives (DeltaChip, InlineNumberSave) via "./AnalyticsTab" — the tab
// entry component's filename is pinned (the shell dynamic-imports it), so
// these barrel re-exports keep those call sites unchanged while the actual
// implementations live in their own modules.
export { DeltaChip } from "./AnalyticsDeltaChip";
export { InlineNumberSave } from "./AnalyticsInlineNumberSave";
export type { Analytics } from "./AnalyticsTypes";

// Each section is its own chunk. This is the point of the split: the tab used to
// be one ~10-panel scroll whose entire cost — the reliability diagram, the sealed
// floor strip, the paged decision log, several tables — was paid on every visit,
// including by the reader who came for the funnel. Now only the active section's
// code is fetched. The gap is a quiet reserved box, never a skeleton.
const sectionGap = () => <div className="reveal-quiet min-h-[28rem]" aria-hidden />;
const PerformanceSection = dynamic(() => import("./sections/PerformanceSection").then((m) => ({ default: m.PerformanceSection })), {
  loading: sectionGap,
});
const EconomicsSection = dynamic(() => import("./sections/EconomicsSection").then((m) => ({ default: m.EconomicsSection })), {
  loading: sectionGap,
});
const QualitySection = dynamic(() => import("./sections/QualitySection").then((m) => ({ default: m.QualitySection })), {
  loading: sectionGap,
});

export function AnalyticsTab() {
  const t = useTranslations("analytics");
  const enumLabel = useEnumLabel();
  const search = useSearchParams();
  const router = useRouter();
  const reduced = useReducedMotion();

  // UAT TOM-ANA-5 — `?funnelEmpty=1` used to be read here and threaded to the
  // Performance section, which never destructured it; its only reader was the
  // orphaned AnalyticsFunnelPanel. A review hatch that changes nothing is worse than
  // no hatch: it makes the zero state look verified when it was never rendered. The
  // real zero-transition guard belongs on the render path, keyed off the data
  // (hasNoStageTransitions), not off a query param — see backlog item 14.

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

  // The active section is APP STATE, with `?sec=` as an inbox only: a link to
  // "Analytics → Quality & audit" is a thing people send each other and must
  // still land, but clicking between sections writes nothing to the URL. Same
  // contract as the tab itself — see shell/nav/useUrlInboxState.ts.
  //
  // `parse` returns null for an unknown value so the current section is left
  // alone; resolveAnalyticsSection's default only applies to the cold start.
  const [section, setSection] = useUrlInboxState<AnalyticsSectionId>(
    "sec",
    (raw) => (raw != null && isAnalyticsSectionId(raw) ? raw : null),
    resolveAnalyticsSection(search.get("sec"))
  );

  const { data, error, reload } = useJsonFetch<Analytics>(
    days ? `/api/analytics?days=${days}` : "/api/analytics",
    t("loadFailed")
  );

  // ANA1 — every chart links to the candidates behind it: a board deep link
  // carrying the matching filter (?stage= funnel stage, ?q= role title), with
  // the other tab-scoped params cleared so the board opens on exactly this
  // cohort. PipelineTab hydrates its filter bar from these at mount.
  //
  // UAT TOM-ANA-1 — this href is unchanged; what was broken sat one layer down.
  // `buildUrl` deleted `tab` whenever it equalled DEFAULT_TAB, so the link shipped
  // the cohort filter with no destination and the click moved nothing. The tab is
  // named here on purpose, and buildUrl now keeps a tab the caller asked for.
  const boardHref = (filter: { q?: string; stage?: string }) =>
    buildUrl({ ...clearedTabScopedParams(), tab: "pipeline", ...filter }, search.toString());

  // ce8e3c9e — index the per-stage conversion deltas by stage for the funnel render.
  // Guarded (data may still be null): computed once here instead of duplicated at
  // each of the call sites below.
  const maxReached = data ? Math.max(1, ...data.funnel.map((f) => f.reached)) : 1;
  const convDeltaByStage = new Map((data?.deltas?.funnel ?? []).map((f) => [f.stage, f.conversionPct]));

  return (
    // Tier 1 (docs/design/loading-choreography.md): the header + switchers render
    // on the first frame regardless of the fetch; aria-busy covers the initial
    // load only — a later refresh (window switch, reload()) never blanks what's
    // already on screen.
    <section className="stagger-children space-y-6" aria-busy={!data && !error}>
      {/* `section` is what lets the window switcher tell the truth about its own
          scope (UAT KAT-ANA-5 / TOM-ANA-7): Quality & audit is deliberately
          window-blind, so on that section the pills grey out and the note says the
          period governs nothing below. Without this prop the header assumes the
          window applies everywhere — which is the claim the finding was about. */}
      <AnalyticsHeader data={data} error={error} days={days} setDays={setDays} section={section} />

      <AnalyticsSectionNav section={section} onSection={setSection} />

      {/* Tier 2: the error affordance, nested under the always-rendering header
          and switcher instead of replacing the whole tab. */}
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

      {/* Tier 2: hold the height while the first fetch is in flight
          (reveal-quiet: invisible for 150ms so a fast response paints nothing),
          then fade the section in. A later refresh re-renders the same branch
          silently — `data` stays non-null across a reload(), so nothing blanks. */}
      {!data && !error ? (
        <div className="reveal-quiet min-h-[28rem]" aria-hidden />
      ) : data ? (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={section}
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0.12 : 0.18, ease: "easeOut" }}
          >
            {section === "performance" ? (
              <PerformanceSection
                data={data}
                enumLabel={enumLabel}
                maxReached={maxReached}
                convDeltaByStage={convDeltaByStage}
                boardHref={boardHref}
                reload={reload}
              />
            ) : null}
            {section === "economics" ? (
              <EconomicsSection data={data} reload={reload} tabScopedSearch={search.toString()} />
            ) : null}
            {section === "quality" ? <QualitySection /> : null}
          </motion.div>
        </AnimatePresence>
      ) : null}
    </section>
  );
}
