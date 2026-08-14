"use client";

import dynamic from "next/dynamic";

// Per-panel chunks for the sectioned Analytics tab — the successor to
// AnalyticsTabChunks.tsx, which chunked the panels of one long scroll.
//
// The chunking matters MORE now, not less: a reader who opens Economics should
// never download the reliability diagram, the sealed-floor strip and the paged
// decision log that live in Quality. The section components below are code-split
// too (see AnalyticsTab), so this is the second level — within a section, the
// heavy below-the-fold panels still arrive on their own chunk.
//
// The loading gap is always a quiet reserved box, never a skeleton.
const chunkGap = (minHeight: string) => {
  const Gap = () => <div className={`reveal-quiet ${minHeight}`} aria-hidden />;
  Gap.displayName = "AnalyticsPanelGap";
  return Gap;
};

// ---- Performance -----------------------------------------------------------
export const MomentumPanel = dynamic(() => import("../AnalyticsMomentumPanel").then((m) => ({ default: m.MomentumPanel })), {
  loading: chunkGap("min-h-[10rem]"),
});
export const OrgBenchmarkPanel = dynamic(() => import("../AnalyticsOrgBenchmarkPanel").then((m) => ({ default: m.OrgBenchmarkPanel })), {
  loading: chunkGap("min-h-[10rem]"),
});

// ---- Economics -------------------------------------------------------------
export const AutomationPanel = dynamic(() => import("../AnalyticsAutomationPanel").then((m) => ({ default: m.AutomationPanel })), {
  loading: chunkGap("min-h-[14rem]"),
});
export const SourcePanel = dynamic(() => import("../AnalyticsSourcePanel").then((m) => ({ default: m.SourcePanel })), {
  loading: chunkGap("min-h-[14rem]"),
});
export const ChannelEconomicsPanel = dynamic(() => import("../AnalyticsChannelEconomicsPanel").then((m) => ({ default: m.ChannelEconomicsPanel })), {
  loading: chunkGap("min-h-[24rem]"),
});
export const ComputeCostPanel = dynamic(() => import("../AnalyticsComputeCostPanel").then((m) => ({ default: m.ComputeCostPanel })), {
  loading: chunkGap("min-h-[16rem]"),
});

// ---- Quality & audit -------------------------------------------------------
export const CalibrationPanel = dynamic(() => import("../AnalyticsCalibrationPanel").then((m) => ({ default: m.CalibrationPanel })), {
  loading: chunkGap("min-h-[20rem]"),
});
export const DecisionRecordsPanel = dynamic(() => import("../AnalyticsDecisionRecordsPanel").then((m) => ({ default: m.DecisionRecordsPanel })), {
  loading: chunkGap("min-h-[14rem]"),
});
export const DecisionLog = dynamic(() => import("../AnalyticsDecisionLog").then((m) => ({ default: m.DecisionLog })), {
  loading: chunkGap("min-h-[20rem]"),
});
