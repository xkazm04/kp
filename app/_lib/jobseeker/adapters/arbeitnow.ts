// Arbeitnow — a free, key-less public job-board API (tier A; sources-catalog.json).
// German, UK and French editions behind one endpoint, many postings from company ATSs,
// each with the board's own `remote` flag. The terms ask for a link back to Arbeitnow: every posting keeps the
// board's own URL, which is what the feed links to.
//
// GET https://www.arbeitnow.com/api/job-board-api?page=N — 250 items a page, newest
// first, `links.next` null on the last page. The API has no documented search
// parameter, so the adapter reads pages (at most ARBEITNOW_MAX_PAGES, and never past
// `maxRefs` kept) and filters locally with matchesTargets/matchesLocations. Every page
// URL is built here; the payload's own `links.next` is read as a yes/no, never
// followed. The body carries the whole advertisement: `detail` fetches nothing.

import type { RawPosting } from "../types";
import { bodyFromHtml, isoOrNull, matchesLocations, matchesTargets, mustOk, parseJsonBody, rawPosting, str, workModeFromText } from "./shared";
import { AdapterCollapsed, type PostingRef, type SourceAdapter } from "./types";

export const ARBEITNOW_HOST = "www.arbeitnow.com";
export const ARBEITNOW_MAX_PAGES = 4;
export const arbeitnowPageUrl = (page: number) => `https://${ARBEITNOW_HOST}/api/job-board-api?page=${page}`;

type Item = Record<string, unknown>;

/** The operator's editions the one API serves (measured 2026-09-25: 100 .com, 75 .co.uk,
 *  75 .fr on page 1), each with the market its domain names. The .com edition carries
 *  German and international postings alike, so it names none. */
const EDITIONS: Record<string, string | null> = {
  "www.arbeitnow.com": null,
  "arbeitnow.com": null,
  "www.arbeitnow.co.uk": "gb",
  "www.arbeitnow.fr": "fr",
};

/** The posting's URL and its edition's market, only when it is on one of the board's
 *  own hosts (the URL is the link-back the terms ask for). */
function boardUrl(v: unknown): { url: string; country: string | null } | null {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && u.hostname in EDITIONS ? { url: u.toString(), country: EDITIONS[u.hostname] ?? null } : null;
  } catch {
    return null; /* not a URL — the item is skipped, never linked */
  }
}

export function arbeitnowItemToRaw(item: Item): RawPosting | null {
  const key = str(item.slug);
  const title = str(item.title);
  const board = boardUrl(item.url);
  if (!key || !title || !board) return null;
  const location = str(item.location);
  const bodyText = bodyFromHtml(str(item.description));
  // The board's flag is its statement. `remote: false` with a text that mentions home
  // office is at most hybrid, so a text-only "remote" is dropped to "did not say".
  const fromText = workModeFromText(`${title} ${location ?? ""} ${bodyText.slice(0, 4000)}`);
  const workMode = item.remote === true ? "remote" : fromText === "remote" ? null : fromText;
  return rawPosting({
    externalKey: key,
    url: board.url,
    title,
    company: str(item.company_name),
    location,
    // The item states a city; only a national edition's domain states a country.
    country: board.country,
    workMode,
    postedAt: isoOrNull(item.created_at),
    bodyText,
  });
}

export const arbeitnowAdapter: SourceAdapter = {
  name: "arbeitnow",
  detailFetches: false,
  async *discover(ctx) {
    let kept = 0;
    for (let page = 1; page <= ARBEITNOW_MAX_PAGES; page++) {
      const out = mustOk(await ctx.fetch(arbeitnowPageUrl(page), { sourceId: ctx.source.id, accept: "application/json" }));
      const payload = parseJsonBody(out.body) as { data?: unknown; links?: { next?: unknown } } | null;
      if (!payload || !Array.isArray(payload.data)) throw new AdapterCollapsed("shape_changed", "Arbeitnow response has no data array");
      for (const item of payload.data as unknown[]) {
        if (!item || typeof item !== "object") continue;
        const raw = arbeitnowItemToRaw(item as Item);
        if (!raw) continue;
        if (!matchesTargets(raw.title, ctx.preferences)) continue;
        if (!matchesLocations(raw, ctx.preferences)) continue;
        yield { externalKey: raw.externalKey, url: raw.url, hint: raw } satisfies PostingRef;
        if (++kept >= ctx.limits.maxRefs) return;
      }
      if (!str(payload.links?.next) || payload.data.length === 0) return;
    }
  },
  async detail(ref) {
    return ref.hint?.title ? rawPosting({ ...ref.hint, externalKey: ref.externalKey, url: ref.url, title: ref.hint.title }) : null;
  },
};
