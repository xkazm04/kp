// EURES — the European Labour Authority's public job-vacancy search (tier A).
//
// POST to the public search endpoint with the seeker's keywords and countries, page
// size 50, at most `maxRefs` refs (default 10 pages). The response carries the whole
// advertisement, so `detail` completes from the hint and fetches nothing. A response
// without the items array is a SHAPE change — `collapsed`, never "zero jobs today".
// Attribution: data © European Labour Authority / EURES (sources-catalog.json).

import type { RawPosting } from "../types";
import { bodyFromHtml, isoCountry, isoOrNull, matchesLocations, mustOk, parseJsonBody, rawPosting, str, workModeFromText } from "./shared";
import { AdapterCollapsed, FetchHalt, type AdapterContext, type PostingRef, type SourceAdapter } from "./types";

export const EURES_SEARCH_URL = "https://europa.eu/eures/api/jv-searchengine/public/jv-search/search";
export const EURES_PAGE_SIZE = 50;
export const EURES_MAX_PAGES = 10;
const EURES_POSTING_URL = "https://europa.eu/eures/portal/jv-se/jv-details/";

type EuresItem = Record<string, unknown>;

function itemsOf(payload: unknown): EuresItem[] | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const list = p.jvs ?? p.items ?? p.results;
  return Array.isArray(list) ? (list as EuresItem[]) : null;
}

/** Czech NUTS-3 region codes -> the region's own name (a place a seeker types). EURES
 *  tags a Czech vacancy with its region only; for other markets the country is enough
 *  for the location filter and the matcher, and no name is guessed. */
const CZ_NUTS3: Record<string, string> = {
  CZ010: "Praha",
  CZ020: "Středočeský kraj",
  CZ031: "Jihočeský kraj",
  CZ032: "Plzeňský kraj",
  CZ041: "Karlovarský kraj",
  CZ042: "Ústecký kraj",
  CZ051: "Liberecký kraj",
  CZ052: "Královéhradecký kraj",
  CZ053: "Pardubický kraj",
  CZ063: "Kraj Vysočina",
  CZ064: "Jihomoravský kraj",
  CZ071: "Olomoucký kraj",
  CZ072: "Zlínský kraj",
  CZ080: "Moravskoslezský kraj",
};

/** Where a EURES vacancy is. The search API answers `locationMap: {"CZ": ["CZ010"]}`
 *  (country -> NUTS codes); an older shape carried `locations: [{countryCode, cityName}]`.
 *  Reading only the old shape stored every posting with no country and no place, so the
 *  city filter and the matcher's location check saw "unknown" for all of them (live scan,
 *  2026-09-25). */
function euresPlace(item: EuresItem): { location: string | null; country: string | null } {
  const locations = Array.isArray(item.locations) ? (item.locations as Record<string, unknown>[]) : [];
  const loc = locations[0];
  if (loc) return { location: str(loc.cityName) ?? str(loc.region), country: str(loc.countryCode)?.toLowerCase() ?? null };
  const map = item.locationMap && typeof item.locationMap === "object" ? (item.locationMap as Record<string, unknown>) : null;
  const first = map ? Object.entries(map)[0] : undefined;
  if (!first) return { location: null, country: null };
  const [code, regions] = first;
  const country = isoCountry(code);
  const nuts = Array.isArray(regions) ? regions.map((r) => str(r)).filter((r): r is string => !!r) : [];
  const names = [...new Set(nuts.map((r) => CZ_NUTS3[r.toUpperCase()]).filter((n): n is string => !!n))];
  return { location: names.length ? names.join(", ") : null, country };
}

export function euresItemToRaw(item: EuresItem): RawPosting | null {
  const id = str(item.id) ?? str(item.jvId);
  const title = str(item.title);
  if (!id || !title) return null;
  const employer = item.employer as Record<string, unknown> | undefined;
  const place = euresPlace(item);
  const description = str(item.description);
  const bodyText = bodyFromHtml(description);
  return rawPosting({
    externalKey: id,
    url: `${EURES_POSTING_URL}${encodeURIComponent(id)}`,
    title,
    company: str(employer?.name),
    location: place.location,
    country: place.country,
    workMode: workModeFromText(`${title} ${bodyText.slice(0, 4000)}`),
    postedAt: isoOrNull(item.creationDate) ?? isoOrNull(item.lastModificationDate),
    bodyText,
    lang: null,
  });
}

/** The seeker's markets as EURES location codes (ISO-2 lower, deduplicated). */
function euresCountryCodes(ctx: AdapterContext): string[] {
  return [...new Set(ctx.preferences.countries.map(isoCountry).filter((c): c is string => c !== null))];
}

/** EURES reads a keyword as ANY of its words ("AI Engineer" = AI or Engineer), so an
 *  EVERYWHERE search sorted by date answered 454,121 vacancies for "AI Engineer" and the
 *  first 300 were cooks, cleaners and fitters (live scan, 2026-09-25). Scoped to TITLE and
 *  sorted BEST_MATCH, the same query leads with "Principal AI Engineer", "AI Engineer
 *  (M/Ž)", "Generative AI / Agentic AI Engineer" - so with stated titles the search is
 *  title-scoped and relevance-sorted; with none it stays the recency feed it was. Role
 *  family slugs ("data_ai") are internal names, never keywords. */
export function euresRequestBody(ctx: AdapterContext, page: number): string {
  const keywords = ctx.preferences.targetTitles.map((k) => k.trim()).filter(Boolean);
  return JSON.stringify({
    keywords: keywords.map((k) => ({ keyword: k, specificSearchCode: "TITLE" })),
    locationCodes: euresCountryCodes(ctx),
    resultsPerPage: EURES_PAGE_SIZE,
    page,
    sortSearch: keywords.length ? "BEST_MATCH" : "MOST_RECENT",
  });
}

export const euresAdapter: SourceAdapter = {
  name: "eures",
  detailFetches: false,
  async *discover(ctx) {
    // EURES takes location codes, and an empty list is a query for nothing: the run
    // would "succeed" with zero postings and say nothing. Stop instead, with a reason
    // reconcile names (`config_*` → config_invalid) and the seeker can fix on /me.
    if (euresCountryCodes(ctx).length === 0) throw new FetchHalt({ kind: "outage", detail: "config_missing_countries" });
    const maxPages = Math.max(1, Math.min(EURES_MAX_PAGES, Math.ceil(ctx.limits.maxRefs / EURES_PAGE_SIZE)));
    let yielded = 0;
    for (let page = 1; page <= maxPages; page++) {
      const out = mustOk(
        await ctx.fetch(EURES_SEARCH_URL, {
          sourceId: ctx.source.id,
          method: "POST",
          body: euresRequestBody(ctx, page),
          contentType: "application/json",
          accept: "application/json",
        })
      );
      const items = itemsOf(parseJsonBody(out.body));
      if (!items) throw new AdapterCollapsed("shape_changed", "EURES search response has no items array");
      for (const item of items) {
        const raw = euresItemToRaw(item);
        if (!raw) continue;
        if (!matchesLocations(raw, ctx.preferences)) continue;
        yield { externalKey: raw.externalKey, url: raw.url, hint: raw } satisfies PostingRef;
        if (++yielded >= ctx.limits.maxRefs) return;
      }
      if (items.length < EURES_PAGE_SIZE) return;
    }
  },
  async detail(ref) {
    const hint = ref.hint;
    if (!hint || !hint.title) return null;
    return rawPosting({ ...hint, externalKey: ref.externalKey, url: ref.url, title: hint.title });
  },
};
