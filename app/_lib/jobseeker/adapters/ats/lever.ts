// Lever Postings API (public): `api.lever.co/v0/postings/<site>?mode=json`; an EU
// tenant lives on `api.eu.lever.co` (config.eu = true). config: { site, eu? }.

import type { RawPosting } from "../../types";
import { bodyFromHtml, cfg, isoOrNull, mustOk, parseJsonBody, rawPosting, safeSlug, str, workModeFromText } from "../shared";
import { AdapterCollapsed, FetchHalt, type PostingRef, type SourceAdapter } from "../types";

export const LEVER_HOST = "api.lever.co";
export const LEVER_EU_HOST = "api.eu.lever.co";
export const leverUrl = (site: string, eu: boolean) => `https://${eu ? LEVER_EU_HOST : LEVER_HOST}/v0/postings/${site}?mode=json`;

export function leverPostingToRaw(p: Record<string, unknown>): RawPosting | null {
  const id = str(p.id);
  const title = str(p.text);
  const url = str(p.hostedUrl) ?? str(p.applyUrl);
  if (!id || !title || !url) return null;
  const cats = p.categories as Record<string, unknown> | undefined;
  const bodyText = [bodyFromHtml(str(p.description)), bodyFromHtml(str(p.additional))].filter(Boolean).join("\n");
  const location = str(cats?.location);
  const workplace = str(p.workplaceType);
  return rawPosting({
    externalKey: id,
    url,
    title,
    location,
    workMode: workplace === "remote" ? "remote" : workplace === "hybrid" ? "hybrid" : workplace === "onsite" ? "onsite" : workModeFromText(`${location ?? ""} ${bodyText.slice(0, 4000)}`),
    postedAt: isoOrNull(p.createdAt),
    bodyText,
  });
}

export const leverAdapter: SourceAdapter = {
  name: "ats_lever",
  detailFetches: false,
  async *discover(ctx) {
    const site = safeSlug(cfg(ctx.source, "site"));
    if (!site) throw new FetchHalt({ kind: "outage", detail: "config_missing_site" });
    const out = mustOk(await ctx.fetch(leverUrl(site, ctx.source.config.eu === true), { sourceId: ctx.source.id, accept: "application/json" }));
    const payload = parseJsonBody(out.body);
    if (!Array.isArray(payload)) throw new AdapterCollapsed("shape_changed", "Lever response is not an array");
    let n = 0;
    for (const p of payload as Record<string, unknown>[]) {
      const raw = leverPostingToRaw(p);
      if (!raw) continue;
      raw.company = cfg(ctx.source, "company") ?? site;
      yield { externalKey: raw.externalKey, url: raw.url, hint: raw } satisfies PostingRef;
      if (++n >= ctx.limits.maxRefs) return;
    }
  },
  async detail(ref) {
    return ref.hint?.title ? rawPosting({ ...ref.hint, externalKey: ref.externalKey, url: ref.url, title: ref.hint.title }) : null;
  },
};
