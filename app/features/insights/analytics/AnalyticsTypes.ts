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
  /** This workspace's offer column, resolved server-side by ROLE (db/analytics.ts).
   *  The offer panel's "who is sitting on an offer" deep link filters the board on it
   *  instead of the literal "Offer", which resolved to nothing on a renamed board.
   *  Optional so an older cached payload (or a fixture) still type-checks; absent and
   *  null both mean "no offer column to link to" and the count renders as plain text. */
  offerStage?: string | null;
  avgTimeToHireDays: number | null;
  // Median of the same time-to-hire samples — the ROI ledger's "median"-labeled tile
  // reads this (analytics-calibration-dashboards #1).
  medianTimeToHireDays: number | null;
  /** How many hires the two statistics above were actually computed over — NOT
   *  `hired`. A hire whose entry lacks one of the two timestamps is a real hire the
   *  median cannot see (4 of 9 on the shipped corpus), so any surface that publishes
   *  the median WITH a sample size must quote this and never `hired`. */
  timeToHireSamples: number;
  // UAT M7 — blended overall cost per hire (Σ channel spend ÷ hires), all-time only.
  costPerHireCzk: number | null;
  /** UAT KAT-ANA-2 — the age of the figure above: the OLDEST `channel_spend.updated_at`
   *  among the rows summed into it (a blend is only as current as its stalest input).
   *  Null whenever `costPerHireCzk` is. */
  costPerHireAsOf: string | null;
  /** UAT KAT-ANA-4 — hires on the EVENT-TIME basis: entries whose TERMINAL TRANSITION
   *  landed inside the window, as distinct from the creation cohort `hired`. Every
   *  per-hire figure with an event-time or ledger-time numerator divides by THIS, so
   *  numerator and denominator describe the same window. */
  hiresClosedInWindow: number;
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
  /** The cohort read hit db/analytics.ts ANALYTICS_COHORT_CAP and every figure was
   *  computed over the newest `cap` entries, not the whole window. Optional for the
   *  same cached-payload reason as excludedSim; nothing renders it yet. */
  truncated?: boolean;
  /** Which clock the window cutoffs and the weekly trend buckets are cut on
   *  (`PipelineAnalytics.bucketTz`). The header states it as a static note. */
  bucketTz?: "UTC";
};

// ANA2 — the selectable windows. null = all time (the server default).
export const WINDOW_CHOICES = [null, 30, 90] as const;

// 82c2b8e8 / b39992b1 — mirror the server's reserved analytics_targets keys.
// Declared locally so the client doesn't import the db barrel (better-sqlite3)
// for two strings.
export const TIME_TO_HIRE_KEY = "time_to_hire";
export const RECRUITER_HOURLY_KEY = "recruiter_hourly_czk";
