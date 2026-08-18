// The one prop shape every Performance variant takes, so the section host can
// swap them without any consumer knowing which is rendering (the prototype
// contract: same props, forked body).
import type { Delta } from "@/app/_lib/analytics-deltas";
import type { Analytics } from "../AnalyticsTypes";

export type PerformanceProps = {
  data: Analytics;
  /** Localized label for an enum value (stage, archetype) — the tab's shared lookup. */
  enumLabel: (kind: string, value: string) => string;
  /** Largest `reached` in the funnel; the bar scale every variant draws against. */
  maxReached: number;
  /** Per-stage conversion deltas vs. the previous period, indexed for render. */
  convDeltaByStage: Map<string, Delta>;
  /** Board deep link carrying the matching filter (ANA1 — every chart links to its candidates). */
  boardHref: (filter: { q?: string; stage?: string }) => string;
  // UAT TOM-ANA-5 — `forceFunnelEmpty` (the `?funnelEmpty=1` review hatch) is gone.
  // It was threaded through three files and destructured by nobody, and the state it
  // simulated is now reached the honest way: `hasNoStageTransitions` is back on the
  // render path, so the zero-transition guide shows when the data says so rather
  // than when a query param says so.
  /** Re-fetch the analytics payload after an inline write (a goal edit). */
  reload: () => void;
};
