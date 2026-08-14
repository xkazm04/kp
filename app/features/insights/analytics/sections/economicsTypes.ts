// The one prop shape every Economics variant takes, so the section host can swap
// them without any consumer knowing which is rendering (the prototype contract:
// same props, forked body).
import type { Analytics } from "../AnalyticsTypes";

export type EconomicsProps = {
  data: Analytics;
  /** Re-fetch the analytics payload after an inline write (a channel spend edit). */
  reload: () => void;
  /** The React-tracked searchParams string, for building cross-tab deep links. */
  tabScopedSearch: string;
};
