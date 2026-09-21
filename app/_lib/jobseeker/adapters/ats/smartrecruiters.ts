// SmartRecruiters Posting API (public, ≤10 rps by their terms — our per-host spacing
// is 2 s+, far under it): the list at `/v1/companies/<co>/postings`, then one GET per
// posting for the body. config: { company }. The detail fetch is the bounded step.

import type { RawPosting } from "../../types";
import { bodyFromHtml, cfg, detailOk, isoOrNull, mustOk, parseJsonBody, rawPosting, safeSlug, str, workModeFromText } from "../shared";
import { AdapterCollapsed, FetchHalt, type PostingRef, type SourceAdapter } from "../types";

export const SMARTRECRUITERS_HOST = "api.smartrecruiters.com";
export const smartrecruitersListUrl = (co: string, offset = 0) => `https://${SMARTRECRUITERS_HOST}/v1/companies/${co}/postings?limit=100&offset=${offset}`;
export const smartrecruitersDetailUrl = (co: string, id: string) => `https://${SMARTRECRUITERS_HOST}/v1/companies/${co}/postings/${encodeURIComponent(id)}`;

function locationOf(p: Record<string, unknown>): { location: string | null; country: string | null; remote: boolean } {
  const loc = p.location as Record<string, unknown> | undefined;
  return {
    location: [str(loc?.city), str(loc?.region)].filter(Boolean).join(", ") || null,
    country: str(loc?.country)?.toLowerCase().slice(0, 2) ?? null,
    remote: loc?.remote === true,
  };
}

export function smartrecruitersListItemToRef(p: Record<string, unknown>, company: string): PostingRef | null {
  const id = str(p.id);
  const title = str(p.name);
  if (!id || !title) return null;
  const { location, country, remote } = locationOf(p);
  const ref = str(p.ref) ?? smartrecruitersDetailUrl(company, id);
  return {
    externalKey: id,
    url: ref,
    hint: {
      title,
      company: str((p.company as Record<string, unknown> | undefined)?.name) ?? company,
      location,
      country,
      workMode: remote ? "remote" : null,
      postedAt: isoOrNull(p.releasedDate),
    },
  };
}

export function smartrecruitersDetailToRaw(d: Record<string, unknown>, ref: PostingRef): RawPosting {
  const ad = d.jobAd as Record<string, unknown> | undefined;
  const sections = (ad?.sections as Record<string, Record<string, unknown>> | undefined) ?? {};
  const bodyText = ["companyDescription", "jobDescription", "qualifications", "additionalInformation"]
    .map((k) => {
      const s = sections[k];
      return s ? `${str(s.title) ?? k}\n${bodyFromHtml(str(s.text))}` : "";
    })
    .filter(Boolean)
    .join("\n");
  const url = str(d.applyUrl) ?? str(d.postingUrl) ?? ref.url;
  return rawPosting({
    ...ref.hint,
    externalKey: ref.externalKey,
    url,
    title: str(d.name) ?? ref.hint?.title ?? "Untitled posting",
    workMode: ref.hint?.workMode ?? workModeFromText(bodyText.slice(0, 4000)),
    postedAt: isoOrNull(d.releasedDate) ?? ref.hint?.postedAt ?? null,
    bodyText,
  });
}

export const smartrecruitersAdapter: SourceAdapter = {
  name: "ats_smartrecruiters",
  detailFetches: true,
  async *discover(ctx) {
    const company = safeSlug(cfg(ctx.source, "company"));
    if (!company) throw new FetchHalt({ kind: "outage", detail: "config_missing_company" });
    let n = 0;
    for (let offset = 0; n < ctx.limits.maxRefs; offset += 100) {
      const out = mustOk(await ctx.fetch(smartrecruitersListUrl(company, offset), { sourceId: ctx.source.id, accept: "application/json" }));
      const payload = parseJsonBody(out.body) as { content?: unknown; totalFound?: unknown } | null;
      if (!payload || !Array.isArray(payload.content)) throw new AdapterCollapsed("shape_changed", "SmartRecruiters response has no content array");
      for (const p of payload.content as Record<string, unknown>[]) {
        const ref = smartrecruitersListItemToRef(p, company);
        if (!ref) continue;
        yield ref;
        if (++n >= ctx.limits.maxRefs) return;
      }
      if (payload.content.length < 100) return;
    }
  },
  async detail(ref, ctx) {
    const company = safeSlug(cfg(ctx.source, "company"));
    if (!company) return null;
    const url = smartrecruitersDetailUrl(company, ref.externalKey);
    const out = detailOk(await ctx.fetch(url, { sourceId: ctx.source.id, accept: "application/json" }), ctx, url);
    if (!out) return null;
    const d = parseJsonBody(out.body);
    if (!d || typeof d !== "object") return null;
    return smartrecruitersDetailToRaw(d as Record<string, unknown>, ref);
  },
};
