// UAT TOM-ANA-12 — the Briefing's own rule, made structural.
//
// PerformanceBriefing states at the top of its own file: "If the data can't
// support a claim, the band says so plainly instead of rendering an inconclusive
// chart." Bands 1 and 2 honoured that by hand; bands 3 and 4 did not, so on an
// empty tenant a display-type „Které role táhnou pipeline." sat directly above the
// first-run empty-state hero. Fixing those two instances would have left the class
// open: nothing made the NEXT band declare a no-data claim either.
//
// So a no-data claim is now part of a band's identity rather than a habit. `BandKey`
// is DERIVED from the table below, `Band` takes that key and resolves the fallback
// itself, and the table is total — a fifth band cannot be written without a message
// key here, and `performanceBands.test.ts` fails if a <Band> is rendered outside the
// table or hands `hasData` a literal instead of a condition.
//
// Register note (guardrail G10): every one of these says *not yet*. None of them
// fakes a zero, and none of them replaces the panel underneath — the panels carry
// their own honest empty states (momentumEmpty, AnalyticsEmptyPreview) and keep
// rendering. Only the heading above them changes.
import type { MomentumWeek } from "@/app/_lib/analytics-momentum";

/** Message key (under the `analytics` namespace) each band falls back to when its
 *  own evidence is empty. Keyed by band; the keys of this table ARE the band
 *  vocabulary, so the two can never drift. */
export const BAND_NO_DATA_CLAIMS = {
  funnel: "briefNoDataClaim",
  forecast: "briefForecastNoSignalClaim",
  // The two the finding named. Both are new copy in the same "not yet" register as
  // the two that already existed.
  momentum: "briefMomentumNoDataClaim",
  roles: "briefRolesNoDataClaim",
} as const;

export type BandKey = keyof typeof BAND_NO_DATA_CLAIMS;

/** The counted series in a momentum week. Declared here rather than in the panel
 *  so the "is there anything to claim" test and the chart's own zero state read the
 *  same four numbers. */
export const MOMENTUM_SERIES_KEYS = ["added", "advanced", "rejected", "hired"] as const;

/** True when every week in the span counted nothing — the exact condition
 *  MomentumPanel uses for its own quiet branch, so the heading and the panel
 *  beneath it cannot disagree about whether anything moved. */
export function momentumIsQuiet(weeks: readonly MomentumWeek[]): boolean {
  return weeks.every((w) => MOMENTUM_SERIES_KEYS.every((k) => w[k] === 0));
}

/** True when the by-role table has at least one row. Same predicate the table uses
 *  to choose between its rows and the tab's first-run empty-state hero — again so
 *  the band heading is decided by the thing it is a heading for. */
export function hasRoleRows(byJob: readonly unknown[]): boolean {
  return byJob.length > 0;
}
