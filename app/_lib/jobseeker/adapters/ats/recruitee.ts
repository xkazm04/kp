// Recruitee careers API (public): `<company>.recruitee.com/api/offers/`. config: { company }.

import type { RawPosting } from "../../types";
import { bodyFromHtml, cfg, isoOrNull, mustOk, parseJsonBody, rawPosting, safeSlug, str, workModeFromText } from "../shared";
import { AdapterCollapsed, FetchHalt, type PostingRef, type SourceAdapter } from "../types";

export const recruiteeHost = (company: string) => `${company}.recruitee.com`;
export const recruiteeUrl = (company: string) => `https://${recruiteeHost(company)}/api/offers/`;

export function recruiteeOfferToRaw(o: Record<string, unknown>): RawPosting | null {
  const id = o.id !== undefined ? String(o.id) : null;
  const title = str(o.title);
  const url = str(o.careers_url) ?? str(o.url);
  if (!id || !title || !url) return null;
  const bodyText = [bodyFromHtml(str(o.description)), bodyFromHtml(str(o.requirements))].filter(Boolean).join("\nRequirements\n");
  const location = str(o.location) ?? str(o.city);
  const remote = o.remote === true;
  return rawPosting({
    externalKey: id,
    url,
    title,
    company: str(o.company_name),
    location,
    country: str(o.country_code)?.toLowerCase() ?? null,
    workMode: remote ? "remote" : workModeFromText(`${location ?? ""} ${bodyText.slice(0, 4000)}`),
    postedAt: isoOrNull(o.published_at) ?? isoOrNull(o.created_at),
    salaryText: str((o.salary as Record<string, unknown> | undefined)?.min) ? JSON.stringify(o.salary) : null,
    bodyText,
  });
}

export const recruiteeAdapter: SourceAdapter = {
  name: "ats_recruitee",
  detailFetches: false,
  async *discover(ctx) {
    const company = safeSlug(cfg(ctx.source, "company"));
    if (!company) throw new FetchHalt({ kind: "outage", detail: "config_missing_company" });
    const out = mustOk(await ctx.fetch(recruiteeUrl(company), { sourceId: ctx.source.id, accept: "application/json" }));
    const payload = parseJsonBody(out.body) as { offers?: unknown } | null;
    if (!payload || !Array.isArray(payload.offers)) throw new AdapterCollapsed("shape_changed", "Recruitee response has no offers array");
    let n = 0;
    for (const o of payload.offers as Record<string, unknown>[]) {
      const raw = recruiteeOfferToRaw(o);
      if (!raw) continue;
      yield { externalKey: raw.externalKey, url: raw.url, hint: raw } satisfies PostingRef;
      if (++n >= ctx.limits.maxRefs) return;
    }
  },
  async detail(ref) {
    return ref.hint?.title ? rawPosting({ ...ref.hint, externalKey: ref.externalKey, url: ref.url, title: ref.hint.title }) : null;
  },
};
