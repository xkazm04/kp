// schema.org/JobPosting → RawPosting. The one mapping every JSON-LD-bearing source
// shares (tier-B detail pages, some ATS pages). Salary is read from baseSalary and
// nowhere else: a value the page did not state stays null (types.ts RawPosting.salary).

import { findJobPosting } from "../rules/engine";
import { htmlTitle } from "../../job-posting-fetch";
import { SALARY_PERIODS, type RawPosting, type SalaryPeriod } from "../types";
import { bodyFromHtml, isoOrNull, num, rawPosting, str, workModeFromText } from "./shared";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function first<T>(v: T | T[] | undefined | null): T | null {
  if (Array.isArray(v)) return v.length ? v[0] : null;
  return v ?? null;
}

/** unitText → our two periods; HOUR/WEEK/DAY are real but outside the vocabulary,
 *  so a posting paid that way reports no comparable salary rather than a wrong one. */
export function periodFromUnitText(unit: unknown): SalaryPeriod | null {
  const u = typeof unit === "string" ? unit.trim().toUpperCase() : "";
  if (u === "MONTH" || u === "MONTHLY") return "month";
  if (u === "YEAR" || u === "ANNUAL" || u === "YEARLY") return "year";
  return null;
}

export function salaryFromBaseSalary(base: unknown): RawPosting["salary"] {
  const b = asRecord(first(base as Record<string, unknown> | Record<string, unknown>[]));
  if (!b) return null;
  const currency = str(b.currency);
  const value = asRecord(b.value);
  let min: number | null = null;
  let max: number | null = null;
  let period: SalaryPeriod | null = null;
  if (value) {
    min = num(value.minValue);
    max = num(value.maxValue);
    const single = num(value.value);
    if (min === null && max === null && single !== null) {
      min = single;
      max = single;
    }
    period = periodFromUnitText(value.unitText);
  } else {
    min = num(b.minValue);
    max = num(b.maxValue);
    const single = num(b.value);
    if (min === null && max === null && single !== null) {
      min = single;
      max = single;
    }
    period = periodFromUnitText(b.unitText);
  }
  if (!currency || (min === null && max === null) || !period || !(SALARY_PERIODS as readonly string[]).includes(period)) return null;
  return { min, max, currency: currency.toUpperCase(), period };
}

export function locationFromJobLocation(jobLocation: unknown): { location: string | null; country: string | null } {
  const place = asRecord(first(jobLocation as Record<string, unknown> | Record<string, unknown>[]));
  const address = asRecord(place?.address) ?? place;
  if (!address) return { location: null, country: null };
  const locality = str(address.addressLocality);
  const region = str(address.addressRegion);
  const countryRaw = address.addressCountry;
  const country = str(asRecord(countryRaw)?.name ?? countryRaw);
  return {
    location: locality ?? region ?? str(address.name),
    country: country ? country.toLowerCase().slice(0, 2) : null,
  };
}

export function identifierOf(jp: Record<string, unknown>): string | null {
  const id = jp.identifier;
  return str(asRecord(id)?.value ?? id);
}

/** Map a JobPosting object (plus the page it came from) to a RawPosting. */
export function rawFromJobPosting(jp: Record<string, unknown>, pageUrl: string, pageHtml: string): RawPosting {
  const description = str(jp.description);
  const bodyText = bodyFromHtml(description) || bodyFromHtml(pageHtml);
  const { location, country } = locationFromJobLocation(jp.jobLocation);
  const locationType = str(jp.jobLocationType);
  const org = asRecord(jp.hiringOrganization);
  const workMode = locationType?.toUpperCase() === "TELECOMMUTE" ? "remote" : workModeFromText(`${str(jp.title) ?? ""} ${bodyText.slice(0, 4000)}`);
  const url = str(jp.url) ?? pageUrl;
  return rawPosting({
    externalKey: identifierOf(jp) ?? url,
    url,
    title: str(jp.title) ?? htmlTitle(pageHtml) ?? "Untitled posting",
    company: str(org?.name) ?? str(jp.hiringOrganization),
    location,
    country,
    workMode,
    postedAt: isoOrNull(jp.datePosted),
    salaryText: null,
    salary: salaryFromBaseSalary(jp.baseSalary),
    bodyText,
    jsonld: jp,
    lang: str(jp.inLanguage) ?? langFromHtml(pageHtml),
  });
}

export function langFromHtml(html: string): string | null {
  const m = /<html\b[^>]*\blang\s*=\s*["']([a-zA-Z]{2})/.exec(html);
  return m ? m[1].toLowerCase() : null;
}

/** A detail page: its JobPosting when it has one, else `<title>` + readable text. */
export function rawFromDetailPage(pageUrl: string, html: string, fallbackKey?: string): RawPosting {
  const jp = findJobPosting(html);
  if (jp) return rawFromJobPosting(jp, pageUrl, html);
  const body = bodyFromHtml(html);
  return rawPosting({
    externalKey: fallbackKey ?? pageUrl,
    url: pageUrl,
    title: htmlTitle(html) ?? "Untitled posting",
    bodyText: body,
    workMode: workModeFromText(body.slice(0, 4000)),
    lang: langFromHtml(html),
  });
}
