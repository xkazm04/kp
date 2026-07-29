"use client";

import { buildUrl, clearedTabScopedParams } from "@/app/features/shell/tabs";
import type { Delta } from "@/app/_lib/analytics-deltas";
import { AnalyticsFunnelPanel } from "./AnalyticsFunnelPanel";
import { AnalyticsArchetypePanel } from "./AnalyticsArchetypePanel";
import { ForecastPanel } from "./AnalyticsForecastPanel";
import { AutomationPanel } from "./AnalyticsAutomationPanel";
import { SourcePanel } from "./AnalyticsSourcePanel";
import type { Analytics } from "./AnalyticsTypes";

// The tab's main event: the funnel/forecast/archetype/automation/source grid.
// Split out of AnalyticsTab.tsx to keep that file under the 200-line cap.
export function AnalyticsMainGrid({
  data,
  enumLabel,
  maxReached,
  convDeltaByStage,
  boardHref,
  forceFunnelEmpty,
  reload,
  tabScopedSearch,
}: {
  data: Analytics;
  enumLabel: (kind: string, value: string) => string;
  maxReached: number;
  convDeltaByStage: Map<string, Delta>;
  boardHref: (filter: { q?: string; stage?: string }) => string;
  forceFunnelEmpty: boolean;
  reload: () => void;
  tabScopedSearch: string;
}) {
  return (
    <div className="animate-arrive-in grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <AnalyticsFunnelPanel
        data={data}
        enumLabel={enumLabel}
        maxReached={maxReached}
        convDeltaByStage={convDeltaByStage}
        boardHref={boardHref}
        forceFunnelEmpty={forceFunnelEmpty}
        reload={reload}
      />

      <div className="space-y-6">
        {/* 094b5870 — forward projection from the same velocity/conversion/TTH,
            now with the observed offer-acceptance probability (Direction 1). */}
        <ForecastPanel funnel={data.funnel} momentum={data.momentum} avgTimeToHireDays={data.avgTimeToHireDays} offers={data.offers} />

        <AnalyticsArchetypePanel byArchetype={data.byArchetype} />
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
    </div>
  );
}
