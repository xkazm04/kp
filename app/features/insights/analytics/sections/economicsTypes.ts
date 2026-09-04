// The one prop shape every Economics variant takes, so the section host can swap
// them without any consumer knowing which is rendering (the prototype contract:
// same props, forked body).
import type { Analytics } from "../AnalyticsTypes";

// The Economics variants read the analytics payload as the host receives it. This
// used to be `Analytics & { costPerHireAsOf?; hiresClosedInWindow? }` — an OPTIONAL
// re-declaration of two fields the server sends on every request, added because
// AnalyticsTypes.ts was outside that change's write set, with a comment asking the
// next change to fold them in. They are folded in now, so the intersection is gone:
// an optional mirror of a field that is always present teaches every consumer to
// treat it as maybe-absent. The alias stays because the props type and its consumers
// name it, and it says which payload this surface reads.
export type EconomicsAnalytics = Analytics;

export type EconomicsProps = {
  data: EconomicsAnalytics;
  /** Re-fetch the analytics payload after an inline write (a channel spend edit). */
  reload: () => void;
  /** The React-tracked searchParams string, for building cross-tab deep links. */
  tabScopedSearch: string;
};
