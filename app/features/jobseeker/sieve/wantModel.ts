// Step 4's pure half: what each card's VIEW says, and what a card's DRAFT commits as.
// No React, no fetch - `node --test` pins it (wantModel.test.ts).
//
// Why drafts exist at all: the step used to write every tap straight to the server and
// then re-read the cards from the server's echo. A pay floor is only storable with BOTH
// an amount and a currency (profile.ts parseSalaryFloor), so choosing a currency first
// saved "no floor", the echo came back empty, and the currency snapped back to "No
// currency" - and dragging the amount first did the same to the amount. Every edit now
// lives in the card's draft until Done, and Done commits a value the store can hold, or
// says why it cannot.

import type { JobseekerPreferences, SalaryFloor, SalaryPeriod } from "@/app/_lib/jobseeker/types";

export type PayDraft = { amount: number; currency: string | null; period: SalaryPeriod };

export function payDraftOf(floor: SalaryFloor | null): PayDraft {
  return floor ? { amount: floor.amount, currency: floor.currency, period: floor.period } : { amount: 0, currency: null, period: "month" };
}

/** Done on the pay card: an amount of 0 is "no floor"; an amount needs its currency. */
export function payFloorOf(draft: PayDraft): { floor: SalaryFloor | null } | { error: "noCurrency" } {
  if (draft.amount <= 0) return { floor: null };
  if (!draft.currency) return { error: "noCurrency" };
  return { floor: { amount: Math.round(draft.amount), currency: draft.currency, period: draft.period } };
}

/** Restating the period restates the amount (x12), the one conversion the engine allows. */
export function restatePeriod(draft: PayDraft, next: SalaryPeriod): PayDraft {
  if (next === draft.period) return draft;
  const amount = next === "year" ? draft.amount * 12 : Math.round(draft.amount / 12);
  return { ...draft, amount, period: next };
}

/** The slider's range for a currency and period (it never clips a stored amount). */
export function payScale(currency: string | null, period: SalaryPeriod): { max: number; step: number } {
  const year = period === "year";
  if (currency === "EUR") return year ? { max: 150_000, step: 1_000 } : { max: 12_000, step: 100 };
  return year ? { max: 3_000_000, step: 10_000 } : { max: 250_000, step: 1_000 };
}

/** How many of the five search-steering cards hold something (languages do not steer). */
export function wantSetCount(prefs: JobseekerPreferences): number {
  return [prefs.locations.length + prefs.countries.length > 0, !!prefs.salaryFloor, prefs.targetTitles.length > 0, prefs.workModes.length > 0, !!prefs.seniority].filter(Boolean).length;
}

/** Add one token to a list: trimmed, case-insensitively unique, never empty. */
export function addToken(list: readonly string[], raw: string): string[] {
  const value = raw.trim();
  if (!value || list.some((x) => x.toLowerCase() === value.toLowerCase())) return [...list];
  return [...list, value];
}

/** A two-letter country code, lower-cased, or null when it is not one. */
export function countryCodeOf(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  return /^[a-z]{2}$/.test(value) ? value : null;
}

/** The fields a card's commit changed, compared with what is stored: an unchanged Done
 *  sends nothing. Lists compare by value, the floor by its three parts. */
export function changedFields(stored: JobseekerPreferences, next: Partial<JobseekerPreferences>): Partial<JobseekerPreferences> {
  const out: Partial<JobseekerPreferences> = {};
  for (const [key, value] of Object.entries(next) as [keyof JobseekerPreferences, unknown][]) {
    if (JSON.stringify(stored[key] ?? null) !== JSON.stringify(value ?? null)) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}
