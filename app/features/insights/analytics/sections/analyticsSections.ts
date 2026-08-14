// The Analytics tab's three sections.
//
// The tab had grown into one ~10-panel scroll that answered three unrelated
// questions at once — "how is hiring going", "what is it costing", "can I trust
// the scoring" — so every visit paid for all three. Splitting them is what makes
// each one affordable to design properly (and to chunk properly: only the active
// section's code and fetches are ever loaded).
//
// Same literal-array + derived-union + runtime-guard shape as
// app/features/shell/tabs.ts: the union and the guard both derive from this one
// array, so a bad ?sec= can't silently resolve to a dead view and adding a
// section is a one-line edit the compiler keeps consistent.

export const ANALYTICS_SECTION_IDS = ["performance", "economics", "quality"] as const;

export type AnalyticsSectionId = (typeof ANALYTICS_SECTION_IDS)[number];

/** The section a bare ?tab=analytics opens on. */
export const DEFAULT_ANALYTICS_SECTION: AnalyticsSectionId = "performance";

export function isAnalyticsSectionId(value: string | null | undefined): value is AnalyticsSectionId {
  return value != null && (ANALYTICS_SECTION_IDS as readonly string[]).includes(value);
}

/** Resolve the ?sec= param, falling back to the default for anything unknown. */
export function resolveAnalyticsSection(param: string | null | undefined): AnalyticsSectionId {
  return isAnalyticsSectionId(param) ? param : DEFAULT_ANALYTICS_SECTION;
}
