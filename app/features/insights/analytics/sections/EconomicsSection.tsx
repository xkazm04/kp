"use client";

// Analytics → Economics: "what is this costing, and which channels earn it back".
//
// A regrouping, not a redesign — these are the panels that used to sit scattered
// down the single scroll (automation ROI beside the funnel, channel economics
// and compute cost far below the by-role table), collected behind the question
// they all answer. The panels themselves are untouched.
import { Defer } from "@/app/_components/ui/Defer";
import { buildUrl, clearedTabScopedParams } from "@/app/features/shell/tabs";
import { AutomationPanel, SourcePanel, ChannelEconomicsPanel, ComputeCostPanel } from "./sectionChunks";
import type { Analytics } from "../AnalyticsTypes";

export function EconomicsSection({
  data,
  reload,
  tabScopedSearch,
}: {
  data: Analytics;
  reload: () => void;
  tabScopedSearch: string;
}) {
  return (
    <div className="animate-arrive-in space-y-6">
      {/* The two "where does the money go / come from" panels lead, side by side
          on wide screens: spend attribution reads against source performance. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <AutomationPanel
          impact={data.automation}
          roi={data.automationRoi}
          costPerHireCzk={data.costPerHireCzk}
          timeToHireDays={data.medianTimeToHireDays}
          onSaved={reload}
          decisionsHref={buildUrl({ ...clearedTabScopedParams(), tab: "decisions" }, tabScopedSearch)}
        />
        <SourcePanel
          rows={data.bySource}
          deltas={data.deltas?.bySource ?? null}
          channelsHref={buildUrl({ ...clearedTabScopedParams(), tab: "channels" }, tabScopedSearch)}
        />
      </div>

      {/* Heavy, data-dependent tables — still deferred until scrolled near, since
          the section can be entered for the ROI figures alone. */}
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

      <Defer strategy="visible">
        <ComputeCostPanel
          computeCost={data.computeCost}
          costPerHireCzk={data.costPerHireCzk}
          hired={data.hired}
          windowed={data.windowDays != null}
        />
      </Defer>
    </div>
  );
}
