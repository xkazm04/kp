// Personio careers XML (public): `<company>.jobs.personio.de/xml?language=en`.
// config: { company, language? }. Each <position> carries its description blocks.

import type { RawPosting } from "../../types";
import { bodyFromHtml, cfg, isoOrNull, mustOk, rawPosting, safeSlug, workModeFromText } from "../shared";
import { xmlBlocks, xmlText } from "../xml";
import { AdapterCollapsed, FetchHalt, type PostingRef, type SourceAdapter } from "../types";

export const personioHost = (company: string) => `${company}.jobs.personio.de`;
export const personioUrl = (company: string, language = "en") => `https://${personioHost(company)}/xml?language=${encodeURIComponent(language)}`;

export function personioPositionToRaw(position: string, company: string): RawPosting | null {
  const id = xmlText(position, "id");
  const title = xmlText(position, "name");
  if (!id || !title) return null;
  const blocks = xmlBlocks(position, "jobDescription").map((b) => `${xmlText(b, "name") ?? ""}\n${bodyFromHtml(xmlText(b, "value"))}`.trim());
  const bodyText = blocks.filter(Boolean).join("\n");
  const location = xmlText(position, "office");
  const schedule = xmlText(position, "schedule");
  return rawPosting({
    externalKey: id,
    url: `https://${personioHost(company)}/job/${encodeURIComponent(id)}`,
    title,
    company: xmlText(position, "subcompany") ?? company,
    location,
    workMode: workModeFromText(`${location ?? ""} ${schedule ?? ""} ${bodyText.slice(0, 4000)}`),
    postedAt: isoOrNull(xmlText(position, "createdAt")),
    bodyText,
  });
}

export const personioAdapter: SourceAdapter = {
  name: "ats_personio",
  detailFetches: false,
  async *discover(ctx) {
    const company = safeSlug(cfg(ctx.source, "company"));
    if (!company) throw new FetchHalt({ kind: "outage", detail: "config_missing_company" });
    const out = mustOk(await ctx.fetch(personioUrl(company, cfg(ctx.source, "language") ?? "en"), { sourceId: ctx.source.id, accept: "application/xml, text/xml;q=0.9" }));
    if (!/<workzag-jobs\b|<position\b/i.test(out.body)) throw new AdapterCollapsed("shape_changed", "Personio feed has no positions");
    let n = 0;
    for (const position of xmlBlocks(out.body, "position")) {
      const raw = personioPositionToRaw(position, cfg(ctx.source, "company_name") ?? company);
      if (!raw) continue;
      yield { externalKey: raw.externalKey, url: raw.url, hint: raw } satisfies PostingRef;
      if (++n >= ctx.limits.maxRefs) return;
    }
  },
  async detail(ref) {
    return ref.hint?.title ? rawPosting({ ...ref.hint, externalKey: ref.externalKey, url: ref.url, title: ref.hint.title }) : null;
  },
};
