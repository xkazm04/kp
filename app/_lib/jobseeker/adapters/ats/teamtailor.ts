// Teamtailor careers RSS (public): `<company>.teamtailor.com/jobs.rss`. config: { company }.
// The feed carries the description; `detail` completes from the hint.

import type { RawPosting } from "../../types";
import { bodyFromHtml, cfg, isoOrNull, mustOk, rawPosting, safeSlug, workModeFromText } from "../shared";
import { xmlBlocks, xmlText } from "../xml";
import { AdapterCollapsed, FetchHalt, type PostingRef, type SourceAdapter } from "../types";

export const teamtailorHost = (company: string) => `${company}.teamtailor.com`;
export const teamtailorUrl = (company: string) => `https://${teamtailorHost(company)}/jobs.rss`;

export function teamtailorItemToRaw(item: string, company: string | null): RawPosting | null {
  const title = xmlText(item, "title");
  const url = xmlText(item, "link");
  if (!title || !url) return null;
  const bodyText = bodyFromHtml(xmlText(item, "description"));
  const categories = xmlBlocks(item, "category").map((c) => c.trim()).filter(Boolean);
  const location = categories.length > 1 ? categories[categories.length - 1] : null;
  return rawPosting({
    externalKey: xmlText(item, "guid") ?? url,
    url,
    title,
    company,
    location,
    workMode: workModeFromText(`${location ?? ""} ${bodyText.slice(0, 4000)}`),
    postedAt: isoOrNull(xmlText(item, "pubDate")),
    bodyText,
  });
}

export const teamtailorAdapter: SourceAdapter = {
  name: "ats_teamtailor",
  detailFetches: false,
  async *discover(ctx) {
    const company = safeSlug(cfg(ctx.source, "company"));
    if (!company) throw new FetchHalt({ kind: "outage", detail: "config_missing_company" });
    const out = mustOk(await ctx.fetch(teamtailorUrl(company), { sourceId: ctx.source.id, accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8" }));
    if (!/<rss\b|<feed\b/i.test(out.body)) throw new AdapterCollapsed("shape_changed", "Teamtailor feed is not RSS");
    const name = xmlText(out.body, "title")?.replace(/\s+[–-]\s+Jobs$/i, "") ?? company;
    let n = 0;
    for (const item of xmlBlocks(out.body, "item")) {
      const raw = teamtailorItemToRaw(item, cfg(ctx.source, "company_name") ?? name);
      if (!raw) continue;
      yield { externalKey: raw.externalKey, url: raw.url, hint: raw } satisfies PostingRef;
      if (++n >= ctx.limits.maxRefs) return;
    }
  },
  async detail(ref) {
    return ref.hint?.title ? rawPosting({ ...ref.hint, externalKey: ref.externalKey, url: ref.url, title: ref.hint.title }) : null;
  },
};
