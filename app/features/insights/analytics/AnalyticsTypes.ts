// Shared payload types for the Analytics tab, split out of AnalyticsTab.tsx to
// keep that file under the 200-line cap. Pure types/consts — no JSX.
import type { MomentumWeek } from "@/app/_lib/analytics-momentum";
import type { OfferConversion } from "@/app/_lib/analytics-offer";
import type { PeriodDeltas } from "@/app/_lib/analytics-deltas";
import type { AutomationImpact } from "@/app/_lib/decision-attribution";
import type { AutomationRoi } from "@/app/_lib/automation-roi";
// `import type` only — erased at compile time, no server code in the bundle.
import type { ChannelEconomics } from "@/app/_lib/db/analytics";
import type { VariantRecommendation, VariantStat } from "@/app/_lib/source-analytics";

export type Funnel = { stage: string; reached: number; current: number; conversionPct: number | null };

export type Analytics = {
  total: number;
  active: number;
  hired: number;
  // Distinct terminal closes: company-side reject vs. candidate-side decline.
  rejected: number;
  declined: number;
  funnel: Funnel[];
  avgTimeToHireDays: number | null;
  // Median of the same time-to-hire samples — the ROI ledger's "median"-labeled tile
  // reads this (analytics-calibration-dashboards #1).
  medianTimeToHireDays: number | null;
  // UAT M7 — blended overall cost per hire (Σ channel spend ÷ hires), all-time only.
  costPerHireCzk: number | null;
  // compute-cost-per-hire — account-wide LLM compute cost from the usage ledger (USD,
  // read-only). Null when the window holds no metered calls. See the DB type note.
  computeCost: {
    costUsd: number;
    calls: number;
    unpricedCalls: number;
    costPerHireUsd: number | null;
    // >1 when multiple workspaces share the workspace-blind ledger — the per-hire
    // figure is suppressed in that case (mixed scope). 1 in a single-workspace account.
    workspaceCount: number;
  } | null;
  avgAgeDays: number | null;
  bottleneck: { stage: string; avgDaysInStage: number; entryCount: number } | null;
  stageDwell: { stage: string; avgDays: number; count: number }[];
  byJob: { jobTitle: string; total: number; reachedInterview: number; hired: number; hireRatePct: number; koDeclined: number }[];
  byJobTotal: number;
  koDeclined: number;
  byArchetype: { archetype: string; total: number; hired: number; advanceRatePct: number }[];
  windowDays: number | null;
  momentum: MomentumWeek[];
  automation: AutomationImpact;
  // Direction 1 — offer-leg conversion (extended/accepted/declined/expired),
  // honesty-gated; also feeds the forecast's acceptance-probability input.
  offers: OfferConversion;
  // b39992b1 — recruiter-hours + CZK the automation saved over the window.
  automationRoi: AutomationRoi;
  bySource: { source: string; total: number; reachedInterview: number; hired: number; hireRatePct: number }[];
  // E5 — funnel economics over stored source attribution.
  byChannel: ChannelEconomics[];
  byVariant: VariantStat[];
  byVariantTotal: number;
  variantRecommendations: VariantRecommendation[];
  // ce8e3c9e — vs-previous-period diffs for the comparable scalars; null in the
  // all-time view (no "previous period" to compare against).
  deltas: PeriodDeltas | null;
  // 82c2b8e8 — recruiter-set goals: per-stage conversion %% targets + a TTH goal.
  targets: { conversion: Record<string, number>; timeToHireDays: number | null };
  /** Board entries in this window that every figure on the page LEFT OUT because
   *  they are guided-demo residue (db/analytics.ts `notSim`). The exclusion is
   *  right; its silence was not — after a demo run the funnel disagreed with the
   *  board and nothing on screen said why. Optional so an older cached payload (or a
   *  fixture) still type-checks; absent and 0 both mean "nothing to say". */
  excludedSim?: number;
};

// ANA2 — the selectable windows. null = all time (the server default).
export const WINDOW_CHOICES = [null, 30, 90] as const;

// 82c2b8e8 / b39992b1 — mirror the server's reserved analytics_targets keys.
// Declared locally so the client doesn't import the db barrel (better-sqlite3)
// for two strings.
export const TIME_TO_HIRE_KEY = "time_to_hire";
export const RECRUITER_HOURLY_KEY = "recruiter_hourly_czk";
