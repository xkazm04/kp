"use client";

import dynamic from "next/dynamic";

// Tier 3 (docs/LOADING_CHOREOGRAPHY.md): AnalyticsTab is the chart-heaviest
// surface in the app — a reliability diagram, a sealed floor-over-time strip, a
// paged decision log, several tables. Every panel below the primary
// funnel/forecast grid gets its own chunk (next/dynamic) and mounts a beat
// later via <Defer> instead of piling onto the tab's first frame. The chunk gap
// is always a quiet reserved box, never a skeleton. Split out of AnalyticsTab.tsx
// to keep that file under the 200-line cap.
const chunkGap = (minHeight: string) => {
  const Gap = () => <div className={`reveal-quiet ${minHeight}`} aria-hidden />;
  Gap.displayName = "AnalyticsPanelGap";
  return Gap;
};

export const MomentumPanel = dynamic(() => import("./AnalyticsMomentumPanel").then((m) => ({ default: m.MomentumPanel })), {
  loading: chunkGap("min-h-[10rem]"),
});
export const OrgBenchmarkPanel = dynamic(() => import("./AnalyticsOrgBenchmarkPanel").then((m) => ({ default: m.OrgBenchmarkPanel })), {
  loading: chunkGap("min-h-[10rem]"),
});
export const CalibrationPanel = dynamic(() => import("./AnalyticsCalibrationPanel").then((m) => ({ default: m.CalibrationPanel })), {
  loading: chunkGap("min-h-[20rem]"),
});
export const DecisionRecordsPanel = dynamic(() => import("./AnalyticsDecisionRecordsPanel").then((m) => ({ default: m.DecisionRecordsPanel })), {
  loading: chunkGap("min-h-[14rem]"),
});
export const ChannelEconomicsPanel = dynamic(() => import("./AnalyticsChannelEconomicsPanel").then((m) => ({ default: m.ChannelEconomicsPanel })), {
  loading: chunkGap("min-h-[24rem]"),
});
export const ComputeCostPanel = dynamic(() => import("./AnalyticsComputeCostPanel").then((m) => ({ default: m.ComputeCostPanel })), {
  loading: chunkGap("min-h-[16rem]"),
});
export const DecisionLog = dynamic(() => import("./AnalyticsDecisionLog").then((m) => ({ default: m.DecisionLog })), {
  loading: chunkGap("min-h-[20rem]"),
});
