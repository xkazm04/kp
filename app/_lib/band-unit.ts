import { APP_CURRENCY } from "./format.ts";

// The leaf of the salary-band contract (salary-band.ts re-exports all of it): a
// currency code's normal form, the no-FX comparability test, and the unit a stored
// band is in (docs/architecture/markets.md). Imports nothing but format.ts.

/** Case/whitespace-insensitive currency code: "czk", " CZK ", and "CZK" all
 *  compare equal; an absent/blank value normalizes to "". */
export function normalizeCurrency(currency: string | null | undefined): string {
  return (currency ?? "").trim().toUpperCase();
}

/** Whether two monetary figures are in the same currency and can therefore be
 *  compared directly (the app does no FX). Used to gate the salary over/under-band
 *  verdict on a match between a candidate's expectation currency and the band's
 *  {@link APP_CURRENCY} denomination. */
export function isSameCurrency(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeCurrency(a) === normalizeCurrency(b);
}

/** The unit a figure is denominated in: ISO-4217 currency + pay period. */
export type BandUnit = { currency: string; period: string };

/** The unit a stored band is in. A band with no stamp is legacy or the Czech seed
 *  corpus, which the boot backfill (db/core.ts backfillTenantScope) also reads as
 *  CZK per month — the one rule, so the reader and the backfill cannot disagree. */
export function bandUnitOf(job: { bandCurrency?: string | null; bandPeriod?: string | null } | null | undefined): BandUnit {
  return { currency: normalizeCurrency(job?.bandCurrency) || APP_CURRENCY, period: job?.bandPeriod?.trim().toLowerCase() || "month" };
}
