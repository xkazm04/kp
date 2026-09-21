// Tier-B boards that publish a sitemap and JSON-LD JobPosting on every detail page
// (startupjobs.cz, prace.cz, profesia.sk, cocuma.cz). config: { sitemapUrl,
// pathFilter? }. Discovery reads the sitemap (an index → its children), yields at
// most `maxRefs` URLs; every detail is a page fetch within politeness, bounded by
// `maxDetailFetches` in reconcile. No JSON-LD → `<title>` + readable text.

import { rawFromDetailPage } from "./jsonld";
import { cfg, detailOk, mustOk } from "./shared";
import { xmlBlocks, xmlText } from "./xml";
import { AdapterCollapsed, FetchHalt, type PostingRef, type SourceAdapter } from "./types";

const MAX_CHILD_SITEMAPS = 20;

export function sitemapLocs(xml: string): { locs: string[]; isIndex: boolean } {
  const isIndex = /<sitemapindex\b/i.test(xml);
  const blocks = xmlBlocks(xml, isIndex ? "sitemap" : "url");
  const locs = blocks.map((b) => xmlText(b, "loc")).filter((l): l is string => Boolean(l));
  return { locs, isIndex };
}

export const boardSitemapJsonldAdapter: SourceAdapter = {
  name: "board_sitemap_jsonld",
  detailFetches: true,
  async *discover(ctx) {
    const sitemapUrl = cfg(ctx.source, "sitemapUrl");
    if (!sitemapUrl) throw new FetchHalt({ kind: "outage", detail: "config_missing_sitemapUrl" });
    const filter = cfg(ctx.source, "pathFilter");
    const root = mustOk(await ctx.fetch(sitemapUrl, { sourceId: ctx.source.id, accept: "application/xml, text/xml;q=0.9" }));
    const parsed = sitemapLocs(root.body);
    if (!/<urlset\b|<sitemapindex\b/i.test(root.body)) throw new AdapterCollapsed("shape_changed", "sitemap is not a urlset or sitemapindex");
    const pages: string[] = parsed.isIndex ? [] : parsed.locs;
    if (parsed.isIndex) {
      for (const child of parsed.locs.slice(0, MAX_CHILD_SITEMAPS)) {
        if (pages.length >= ctx.limits.maxRefs) break;
        const out = mustOk(await ctx.fetch(child, { sourceId: ctx.source.id, accept: "application/xml, text/xml;q=0.9" }));
        pages.push(...sitemapLocs(out.body).locs);
      }
    }
    let n = 0;
    for (const url of pages) {
      if (filter && !url.includes(filter)) continue;
      yield { externalKey: url, url } satisfies PostingRef;
      if (++n >= ctx.limits.maxRefs) return;
    }
  },
  async detail(ref, ctx) {
    const out = detailOk(await ctx.fetch(ref.url, { sourceId: ctx.source.id, accept: "text/html, application/xhtml+xml;q=0.9" }), ctx, ref.url);
    if (!out) return null;
    const raw = rawFromDetailPage(out.finalUrl || ref.url, out.body, ref.externalKey);
    // The sitemap URL is the identity we saw the posting under; a JSON-LD identifier
    // is preferred when present so a moved slug does not duplicate the row.
    return { ...raw, url: ref.url };
  },
};
