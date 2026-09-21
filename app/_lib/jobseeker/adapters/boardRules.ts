// Tier-B boards with neither sitemap nor JSON-LD (jobs.cz): authored extraction
// rules over server-rendered listing pages. config: { listingUrls: string[] } with a
// `{page}` placeholder, `maxPages?`. Every listing page runs the source's rules
// (rules/engine.ts); a fetched page where a REQUIRED rule matched nothing is the
// board's redesign → AdapterCollapsed (the run becomes `collapsed`, the source pauses).

import { rawFromDetailPage } from "./jsonld";
import { runRules } from "../rules/engine";
import { isCollapsed } from "../rules/collapse";
import { detailOk, mustOk, rawPosting, str, workModeFromText } from "./shared";
import { AdapterCollapsed, FetchHalt, type PostingRef, type SourceAdapter } from "./types";
import type { RawPosting } from "../types";

const DEFAULT_MAX_PAGES = 5;

export function listingPages(source: { config: Record<string, unknown> }): string[] {
  const raw = source.config.listingUrls;
  const templates = Array.isArray(raw) ? raw.filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u)) : [];
  const maxPages = Math.max(1, Math.min(50, Number(source.config.maxPages) || DEFAULT_MAX_PAGES));
  const out: string[] = [];
  for (const t of templates) {
    if (t.includes("{page}")) {
      for (let p = 1; p <= maxPages; p++) out.push(t.replace("{page}", String(p)));
    } else out.push(t);
  }
  return out;
}

function firstStr(v: string | string[] | null): string | null {
  return Array.isArray(v) ? str(v[0]) : str(v);
}

export const boardRulesAdapter: SourceAdapter = {
  name: "board_rules",
  detailFetches: true,
  async *discover(ctx) {
    const rules = ctx.source.rules;
    if (!rules || rules.length === 0) throw new FetchHalt({ kind: "outage", detail: "config_missing_rules" });
    const pages = listingPages(ctx.source);
    if (pages.length === 0) throw new FetchHalt({ kind: "outage", detail: "config_missing_listingUrls" });
    const seen = new Set<string>();
    let n = 0;
    for (const [index, page] of pages.entries()) {
      const out = mustOk(await ctx.fetch(page, { sourceId: ctx.source.id, accept: "text/html, application/xhtml+xml;q=0.9" }));
      const { items, perRule } = runRules(rules, out.body, out.finalUrl || page);
      // A LATER page where EVERY rule matched nothing is the end of the listing (a
      // page past the last one); the same on the first page is the redesign.
      if (index > 0 && perRule.every((r) => r.matched === 0)) return;
      if (isCollapsed(perRule, rules, ctx.source.rulesBaseline)) {
        const missing = perRule.filter((r) => r.matched === 0).map((r) => r.field);
        throw new AdapterCollapsed("required_rule_miss", `${page}: no match for ${missing.join(", ")}`);
      }
      let pageRefs = 0;
      for (const item of items) {
        const url = firstStr(item.url);
        if (!url) continue;
        const externalKey = firstStr(item.externalKey) ?? url;
        if (seen.has(externalKey)) continue;
        seen.add(externalKey);
        const hint: Partial<RawPosting> = {
          title: firstStr(item.title) ?? undefined,
          company: firstStr(item.company),
          location: firstStr(item.location),
          postedAt: firstStr(item.postedAt),
          salaryText: firstStr(item.salaryText),
        };
        yield { externalKey, url, hint } satisfies PostingRef;
        pageRefs++;
        if (++n >= ctx.limits.maxRefs) return;
      }
      // An empty later page is the end of the listing, not a collapse (the required rules matched).
      if (pageRefs === 0) return;
    }
  },
  async detail(ref, ctx) {
    const out = detailOk(await ctx.fetch(ref.url, { sourceId: ctx.source.id, accept: "text/html, application/xhtml+xml;q=0.9" }), ctx, ref.url);
    const hint = ref.hint ?? {};
    if (!out) {
      // The listing already named the posting; keep it with what the card said.
      return hint.title ? rawPosting({ ...hint, externalKey: ref.externalKey, url: ref.url, title: hint.title, bodyText: "" }) : null;
    }
    const page = rawFromDetailPage(ref.url, out.body, ref.externalKey);
    return rawPosting({
      ...page,
      externalKey: ref.externalKey,
      url: ref.url,
      title: hint.title ?? page.title,
      company: hint.company ?? page.company,
      location: hint.location ?? page.location,
      postedAt: hint.postedAt ?? page.postedAt,
      salaryText: hint.salaryText ?? page.salaryText,
      workMode: page.workMode ?? workModeFromText(`${hint.location ?? ""} ${hint.title ?? ""}`),
    });
  },
};
