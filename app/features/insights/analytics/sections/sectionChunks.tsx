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
//
// These stay DECORATIVE (`aria-hidden`) while the whole-view gaps moved to
// `<LoadingGap>` (a named `role="status"` region). Five of these mount at once,
// below a section heading that has ALREADY rendered and been announced: the reader
// knows which section they are in and that its panels are arriving. Five
// simultaneous "Loading" announcements would be noise, and noise in a live region
// is worse than silence. See the rule stated on LoadingGap itself.
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
// UAT KAT-ANA-3 — `SourcePanel` and `ChannelEconomicsPanel` used to be declared here
// and imported by NO section: the consolidation folded their tables into
// EconomicsBoard and left the barrel entries behind. That was not cosmetic.
// ChannelEconomicsPanel hosted the product's only write path to `channel_spend`, so
// exporting it without rendering it silently bricked cost-per-hire while the figure
// kept rendering from a six-week-old row (KAT-ANA-2).
//
// The verdict (backlog item 11): DELETE both. The board renders each taxonomy as a
// row group with one shared set of unit-economics columns, the spend editor has been
// lifted into it, and re-importing either panel would put a second acquisition table
// on the page — the consolidation §2.25 explicitly declines to revert. A declared
// chunk nobody imports is exactly the unreachable state that hid the write path, so
// the entries go now; the two module files are removed in the same drain.
//
// What must not be lost with them was pinned in analyticsRenderMap.test.ts until it
// landed: the pause recommendations (`variantRecommendations`) and the variant cap
// notice (`byVariantTotal`) BOTH now render in EconomicsBoard.tsx, and that test's
// staged allowlists are empty as a result. (This comment claimed the opposite for a
// few hours after the wire went in — a stale comment about unrendered data, inside
// the very file whose orphaned exports started this item, is precisely the drift the
// render-map guard exists to catch, so it is worth keeping accurate.)
// Every export below is imported by a section — the test asserts the ratio,
// because a file count answers a different question than "is this rendered anywhere".
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
