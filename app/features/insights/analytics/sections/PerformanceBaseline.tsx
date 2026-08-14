"use client";

// The Performance section as it renders today — the funnel/forecast/archetype
// grid, momentum, the org benchmark and the by-role table, in their existing
// order and layout. The A/B control: it exists so each directional variant is
// judged against what actually ships, not against a remembered version of it.
//
// The only change from AnalyticsMainGrid is subtraction: the automation and
// source panels that shared that grid have moved to the Economics section, where
// the question they answer lives.
import { Defer } from "@/app/_components/ui/Defer";
import { AnalyticsFunnelPanel } from "../AnalyticsFunnelPanel";
import { AnalyticsArchetypePanel } from "../AnalyticsArchetypePanel";
import { ForecastPanel } from "../AnalyticsForecastPanel";
import { AnalyticsByRoleTable } from "../AnalyticsByRoleTable";
import { MomentumPanel, OrgBenchmarkPanel } from "./sectionChunks";
import type { PerformanceProps } from "./performanceTypes";

export function PerformanceBaseline({
  data,
  enumLabel,
  maxReached,
  convDeltaByStage,
  boardHref,
  forceFunnelEmpty,
  reload,
}: PerformanceProps) {
  return (
    <div className="space-y-6">
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
          <ForecastPanel
            funnel={data.funnel}
            momentum={data.momentum}
            avgTimeToHireDays={data.avgTimeToHireDays}
            offers={data.offers}
          />
          <AnalyticsArchetypePanel byArchetype={data.byArchetype} />
        </div>
      </div>

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
