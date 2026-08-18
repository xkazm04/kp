// The one prop shape every Economics variant takes, so the section host can swap
// them without any consumer knowing which is rendering (the prototype contract:
// same props, forked body).
import type { Analytics } from "../AnalyticsTypes";

// UAT KAT-ANA-2 / KAT-ANA-4 — two fields the SERVER payload now carries that the
// client mirror in AnalyticsTypes.ts has not declared yet (that file is outside this
// change's write set). Declared OPTIONAL and intersected here so the Economics surface
// can read them without a cast and without touching the host: an optional property is
// satisfied vacuously, so `Analytics` stays assignable to this and AnalyticsTab needs
// no edit. Fold both into AnalyticsTypes.Analytics — and delete this intersection —
// the next time that file is opened.
export type EconomicsAnalytics = Analytics & {
  /** Oldest `channel_spend.updated_at` behind `costPerHireCzk`; null when there is no
   *  blended figure. A money number derived from a stored row must date itself. */
  costPerHireAsOf?: string | null;
  /** Hires whose TERMINAL TRANSITION fell in the window — the denominator every
   *  event-time per-hire figure divides by, as distinct from the creation cohort
   *  `hired`. */
  hiresClosedInWindow?: number;
};

export type EconomicsProps = {
  data: EconomicsAnalytics;
  /** Re-fetch the analytics payload after an inline write (a channel spend edit). */
  reload: () => void;
  /** The React-tracked searchParams string, for building cross-tab deep links. */
  tabScopedSearch: string;
};
