// History's query door (challenge-r09 cv-analyze-workspace/A).
//
// History used to fetch the newest 200 groups and search/filter that slice on the
// client, so past 200 groups every answer was wrong: a search missed older
// candidates, a family only older runs carry could not be picked, and 'undecided'
// under-counted. The query now goes to /api/analyses, which filters over the whole
// workspace before its window, pages by keyset cursor, and answers the dropdown
// vocabulary (facets) for the whole workspace. This module is the pure half: what
// goes on the wire, how a second page joins the first, how a body is read.
import { readAnalysesListPayload, type AnalysesListPage, type AnalysisRow } from "./HistoryTypes";

export type HistoryQuery = { q: string; family: string; seniority: string; disposition: string };

export const EMPTY_HISTORY_QUERY: HistoryQuery = { q: "", family: "", seniority: "", disposition: "" };

export type HistoryFacets = { families: string[]; seniorities: string[] };

export type HistoryPage = AnalysesListPage & { nextCursor: string | null; facets: HistoryFacets | null };

/** True when the query narrows anything (a whitespace-only search does not). */
export function isHistoryFiltering(query: HistoryQuery): boolean {
  return Boolean(query.q.trim() || query.family || query.seniority || query.disposition);
}

/** The /api/analyses query string for `query` (and a continuation cursor). Only what
 *  narrows is sent, so an idle History asks the same bare door it always did. */
export function toSearchParams(query: HistoryQuery, cursor?: string | null): string {
  const params = new URLSearchParams();
  const q = query.q.trim();
  if (q) params.set("q", q);
  if (query.family) params.set("family", query.family);
  if (query.seniority) params.set("seniority", query.seniority);
  if (query.disposition) params.set("disposition", query.disposition);
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

/** Append a continuation page to what is on screen: server order kept, a slug already
 *  shown is not shown twice (a group re-run between two loads can come back). */
export function mergeHistoryPages(prev: AnalysisRow[], next: AnalysisRow[]): AnalysisRow[] {
  const seen = new Set(prev.map((r) => r.slug));
  const merged = [...prev];
  for (const row of next) {
    if (seen.has(row.slug)) continue;
    seen.add(row.slug);
    merged.push(row);
  }
  return merged;
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "") : [];

/** Read a /api/analyses body. Missing facets are null ("not answered"), never an empty
 *  vocabulary that would hide every dropdown option. */
export function readHistoryPage(payload: unknown): HistoryPage {
  const base = readAnalysesListPayload(payload);
  const body = (payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}) as {
    nextCursor?: unknown;
    facets?: unknown;
  };
  const nextCursor = typeof body.nextCursor === "string" && body.nextCursor ? body.nextCursor : null;
  const raw = body.facets && typeof body.facets === "object" ? (body.facets as { families?: unknown; seniorities?: unknown }) : null;
  const facets = raw ? { families: strings(raw.families), seniorities: strings(raw.seniorities) } : null;
  return { ...base, nextCursor, facets };
}
