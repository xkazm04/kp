// Ashby posting API (public): `api.ashbyhq.com/posting-api/job-board/<name>?includeCompensation=true`.
// config: { board }. Compensation, when published, is a structured tier list.

import type { RawPosting } from "../../types";
import { periodFromUnitText } from "../jsonld";
import { bodyFromHtml, cfg, isoOrNull, mustOk, num, parseJsonBody, rawPosting, safeSlug, str, workModeFromText } from "../shared";
import { AdapterCollapsed, FetchHalt, type PostingRef, type SourceAdapter } from "../types";

export const ASHBY_HOST = "api.ashbyhq.com";
export const ashbyUrl = (board: string) => `https://${ASHBY_HOST}/posting-api/job-board/${board}?includeCompensation=true`;

function compensationOf(j: Record<string, unknown>): { salary: RawPosting["salary"]; text: string | null } {
  const comp = j.compensation as Record<string, unknown> | undefined;
  const text = str(comp?.compensationTierSummary) ?? str(comp?.scrapeableCompensationSalarySummary);
  const tiers = Array.isArray(comp?.compensationTiers) ? (comp!.compensationTiers as Record<string, unknown>[]) : [];
  for (const tier of tiers) {
    const comps = Array.isArray(tier.components) ? (tier.components as Record<string, unknown>[]) : [];
    const salary = comps.find((c) => str(c.compensationType) === "Salary");
    if (!salary) continue;
    const currency = str(salary.currencyCode);
    const period = periodFromUnitText(str(salary.interval)?.replace(/^1 /, "").toUpperCase());
    const min = num(salary.minValue);
    const max = num(salary.maxValue);
    if (currency && period && (min !== null || max !== null)) return { salary: { min, max, currency, period }, text };
  }
  return { salary: null, text };
}

export function ashbyJobToRaw(j: Record<string, unknown>, company: string | null): RawPosting | null {
  const id = str(j.id);
  const title = str(j.title);
  const url = str(j.jobUrl) ?? str(j.applyUrl);
  if (!id || !title || !url) return null;
  const bodyText = bodyFromHtml(str(j.descriptionHtml)) || (str(j.descriptionPlain) ?? "");
  const location = str(j.location);
  const { salary, text } = compensationOf(j);
  const address = (j.address as Record<string, unknown> | undefined)?.postalAddress as Record<string, unknown> | undefined;
  return rawPosting({
    externalKey: id,
    url,
    title,
    company,
    location,
    country: str(address?.addressCountry)?.toLowerCase().slice(0, 2) ?? null,
    workMode: j.isRemote === true ? "remote" : workModeFromText(`${location ?? ""} ${bodyText.slice(0, 4000)}`),
    postedAt: isoOrNull(j.publishedAt),
    salaryText: text,
    salary,
    bodyText,
  });
}

export const ashbyAdapter: SourceAdapter = {
  name: "ats_ashby",
  detailFetches: false,
  async *discover(ctx) {
    const board = safeSlug(cfg(ctx.source, "board"));
    if (!board) throw new FetchHalt({ kind: "outage", detail: "config_missing_board" });
    const out = mustOk(await ctx.fetch(ashbyUrl(board), { sourceId: ctx.source.id, accept: "application/json" }));
    const payload = parseJsonBody(out.body) as { jobs?: unknown } | null;
    if (!payload || !Array.isArray(payload.jobs)) throw new AdapterCollapsed("shape_changed", "Ashby response has no jobs array");
    let n = 0;
    for (const j of payload.jobs as Record<string, unknown>[]) {
      const raw = ashbyJobToRaw(j, cfg(ctx.source, "company_name") ?? board);
      if (!raw) continue;
      yield { externalKey: raw.externalKey, url: raw.url, hint: raw } satisfies PostingRef;
      if (++n >= ctx.limits.maxRefs) return;
    }
  },
  async detail(ref) {
    return ref.hint?.title ? rawPosting({ ...ref.hint, externalKey: ref.externalKey, url: ref.url, title: ref.hint.title }) : null;
  },
};
