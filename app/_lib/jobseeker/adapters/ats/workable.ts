// Workable careers widget API (public): `apply.workable.com/api/v1/widget/accounts/<sub>?details=true`.
// config: { subdomain }.

import type { RawPosting } from "../../types";
import { bodyFromHtml, cfg, isoOrNull, mustOk, parseJsonBody, rawPosting, safeSlug, str, workModeFromText } from "../shared";
import { AdapterCollapsed, FetchHalt, type PostingRef, type SourceAdapter } from "../types";

export const WORKABLE_HOST = "apply.workable.com";
export const workableUrl = (sub: string) => `https://${WORKABLE_HOST}/api/v1/widget/accounts/${sub}?details=true`;

export function workableJobToRaw(j: Record<string, unknown>, company: string | null): RawPosting | null {
  const id = str(j.shortcode) ?? (j.id !== undefined ? String(j.id) : null);
  const title = str(j.title);
  const url = str(j.url) ?? str(j.shortlink);
  if (!id || !title || !url) return null;
  const bodyText = [bodyFromHtml(str(j.description)), bodyFromHtml(str(j.requirements)), bodyFromHtml(str(j.benefits))].filter(Boolean).join("\n");
  const location = [str(j.city), str(j.state)].filter(Boolean).join(", ") || null;
  return rawPosting({
    externalKey: id,
    url,
    title,
    company,
    location,
    country: str(j.country)?.toLowerCase().slice(0, 2) ?? null,
    workMode: j.telecommuting === true ? "remote" : workModeFromText(`${location ?? ""} ${bodyText.slice(0, 4000)}`),
    postedAt: isoOrNull(j.published_on) ?? isoOrNull(j.created_at),
    bodyText,
  });
}

export const workableAdapter: SourceAdapter = {
  name: "ats_workable",
  detailFetches: false,
  async *discover(ctx) {
    const sub = safeSlug(cfg(ctx.source, "subdomain"));
    if (!sub) throw new FetchHalt({ kind: "outage", detail: "config_missing_subdomain" });
    const out = mustOk(await ctx.fetch(workableUrl(sub), { sourceId: ctx.source.id, accept: "application/json" }));
    const payload = parseJsonBody(out.body) as { name?: unknown; jobs?: unknown } | null;
    if (!payload || !Array.isArray(payload.jobs)) throw new AdapterCollapsed("shape_changed", "Workable response has no jobs array");
    let n = 0;
    for (const j of payload.jobs as Record<string, unknown>[]) {
      const raw = workableJobToRaw(j, cfg(ctx.source, "company_name") ?? str(payload.name) ?? sub);
      if (!raw) continue;
      yield { externalKey: raw.externalKey, url: raw.url, hint: raw } satisfies PostingRef;
      if (++n >= ctx.limits.maxRefs) return;
    }
  },
  async detail(ref) {
    return ref.hint?.title ? rawPosting({ ...ref.hint, externalKey: ref.externalKey, url: ref.url, title: ref.hint.title }) : null;
  },
};
