// Preference validation and merge — the ONE place a JobseekerPreferences payload is
// shaped before it reaches the store.
//
// Two doors hand preferences in: PUT /api/jobseeker/profile (the seeker's own edit)
// and the cv_polish dialog's artifact (authored by a model, coerced at the spawn
// boundary and again here). Both are untrusted for the same reason a choice card is:
// the shape on the wire is a claim, and the store must only ever hold values the
// runtime guards in types.ts vouch for. Unknown fields are DROPPED, never repaired —
// a malformed salary floor is not a floor at all, because a floor without a currency
// cannot be compared to anything (salary-band.ts: no conversion, ever).
//
// Pure, no React, no Node built-ins: node --test loads it and so does the browser.

import {
  DEFAULT_DEEP_DIVE,
  EMPTY_PREFERENCES,
  SALARY_PERIODS,
  isSeniority,
  isWorkMode,
  type DeepDivePolicy,
  type JobseekerPreferences,
  type SalaryFloor,
  type SalaryPeriod,
  type WorkMode,
} from "./types";

const MAX_LIST = 20;
const MAX_ITEM_CHARS = 80;
const MAX_CURRENCY_CHARS = 8;

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function stringList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const item of raw) {
    const text = clean(item, MAX_ITEM_CHARS);
    if (text && !out.some((x) => x.toLowerCase() === text.toLowerCase())) out.push(text);
    if (out.length === MAX_LIST) break;
  }
  return out;
}

/** ISO-3166-1 alpha-2, lower-case; anything else is not a country the adapters know. */
function countryList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const item of raw) {
    const code = typeof item === "string" ? item.trim().toLowerCase() : "";
    if (/^[a-z]{2}$/.test(code) && !out.includes(code)) out.push(code);
    if (out.length === MAX_LIST) break;
  }
  return out;
}

function isSalaryPeriod(v: unknown): v is SalaryPeriod {
  return typeof v === "string" && (SALARY_PERIODS as readonly string[]).includes(v);
}

/** A floor is amount > 0 + an upper-cased currency code + a known period; a payload
 *  missing any of the three is `null` (not a floor), and `undefined` means "the
 *  field was not sent" so a merge leaves the stored one alone. */
export function parseSalaryFloor(raw: unknown): SalaryFloor | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const amount = typeof r.amount === "number" && Number.isFinite(r.amount) ? Math.round(r.amount) : NaN;
  const currency = clean(r.currency, MAX_CURRENCY_CHARS).toUpperCase();
  if (!(amount > 0) || !/^[A-Z]{3}$/.test(currency) || !isSalaryPeriod(r.period)) return null;
  return { amount, currency, period: r.period };
}

function parseDeepDive(raw: unknown): DeepDivePolicy | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const clamp = (v: unknown, lo: number, hi: number, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
  return {
    threshold: clamp(r.threshold, 0, 100, DEFAULT_DEEP_DIVE.threshold),
    maxPerScan: clamp(r.maxPerScan, 0, 50, DEFAULT_DEEP_DIVE.maxPerScan),
  };
}

/** The PARTIAL read: only the fields the payload carries, each validated. This is
 *  what the dialog artifact produces and what PUT accepts under `preferences`. */
export function parsePreferencesPatch(raw: unknown): Partial<JobseekerPreferences> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<JobseekerPreferences> = {};
  const locations = stringList(r.locations);
  if (locations) out.locations = locations;
  const countries = countryList(r.countries);
  if (countries) out.countries = countries;
  if (Array.isArray(r.workModes)) {
    const modes: WorkMode[] = [];
    for (const m of r.workModes) if (isWorkMode(m) && !modes.includes(m)) modes.push(m);
    out.workModes = modes;
  }
  const floor = parseSalaryFloor(r.salaryFloor);
  if (floor !== undefined) out.salaryFloor = floor;
  const families = stringList(r.targetRoleFamilies);
  if (families) out.targetRoleFamilies = families;
  const titles = stringList(r.targetTitles);
  if (titles) out.targetTitles = titles;
  const languages = stringList(r.languages);
  if (languages) out.languages = languages;
  if ("seniority" in r) out.seniority = isSeniority(r.seniority) ? r.seniority : null;
  const deepDive = parseDeepDive(r.deepDive);
  if (deepDive) out.deepDive = deepDive;
  return out;
}

/** The FULL read: a complete, valid JobseekerPreferences whatever arrived. */
export function parsePreferences(raw: unknown): JobseekerPreferences {
  return { ...EMPTY_PREFERENCES, ...parsePreferencesPatch(raw) };
}

/** Shallow merge, `undefined` members never overwrite (the store's own rule). An
 *  empty list from the patch does not erase a stated one — a turn that did not
 *  mention places must not delete the places stated two turns earlier. */
export function mergePreferencePatch(base: JobseekerPreferences, partial: Partial<JobseekerPreferences>): JobseekerPreferences {
  const merged: JobseekerPreferences = { ...base };
  for (const [key, value] of Object.entries(partial) as [keyof JobseekerPreferences, unknown][]) {
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length === 0 && (base[key] as unknown[] | undefined)?.length) continue;
    (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}
