// ATS discovery: given a company slug, probe each vendor's public pattern ONCE and
// return the ones that answer. A `blocked` or `gone` is a no; an `ok` whose body has
// the vendor's shape is a hit. Every probe rides politeFetch, so it is spaced and
// robots-checked like any other request, and `offline` stops the sweep at the first
// probe (the caller sees an empty list and the outcome).

import type { FetchOutcome, PoliteFetch } from "../../fetch/politeFetch";
import type { SourceAdapterName } from "../../types";
import { ASHBY_HOST, ashbyUrl } from "./ashby";
import { GREENHOUSE_HOST, greenhouseUrl } from "./greenhouse";
import { LEVER_HOST, leverUrl } from "./lever";
import { personioHost, personioUrl } from "./personio";
import { recruiteeHost, recruiteeUrl } from "./recruitee";
import { SMARTRECRUITERS_HOST, smartrecruitersListUrl } from "./smartrecruiters";
import { teamtailorHost, teamtailorUrl } from "./teamtailor";
import { WORKABLE_HOST, workableUrl } from "./workable";

export type AtsHit = { adapter: SourceAdapterName; host: string; config: Record<string, unknown> };

type Probe = { adapter: SourceAdapterName; url: string; host: string; config: Record<string, unknown>; looksRight: (body: string) => boolean };

export function atsProbes(slug: string): Probe[] {
  const s = slug.toLowerCase();
  return [
    { adapter: "ats_greenhouse", url: greenhouseUrl(s), host: GREENHOUSE_HOST, config: { token: s }, looksRight: (b) => /"jobs"\s*:\s*\[/.test(b) },
    { adapter: "ats_lever", url: leverUrl(s, false), host: LEVER_HOST, config: { site: s }, looksRight: (b) => /^\s*\[/.test(b) && /"hostedUrl"|"text"/.test(b) },
    { adapter: "ats_recruitee", url: recruiteeUrl(s), host: recruiteeHost(s), config: { company: s }, looksRight: (b) => /"offers"\s*:\s*\[/.test(b) },
    { adapter: "ats_teamtailor", url: teamtailorUrl(s), host: teamtailorHost(s), config: { company: s }, looksRight: (b) => /<rss\b/i.test(b) },
    { adapter: "ats_personio", url: personioUrl(s), host: personioHost(s), config: { company: s }, looksRight: (b) => /<position\b|<workzag-jobs\b/i.test(b) },
    { adapter: "ats_workable", url: workableUrl(s), host: WORKABLE_HOST, config: { subdomain: s }, looksRight: (b) => /"jobs"\s*:\s*\[/.test(b) },
    { adapter: "ats_ashby", url: ashbyUrl(s), host: ASHBY_HOST, config: { board: s }, looksRight: (b) => /"jobs"\s*:\s*\[/.test(b) },
    { adapter: "ats_smartrecruiters", url: smartrecruitersListUrl(s), host: SMARTRECRUITERS_HOST, config: { company: s }, looksRight: (b) => /"content"\s*:\s*\[/.test(b) },
  ];
}

export async function atsDiscover(companySlug: string, fetch: PoliteFetch): Promise<{ hits: AtsHit[]; halted: FetchOutcome | null }> {
  const slug = companySlug.trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(slug)) return { hits: [], halted: null };
  const hits: AtsHit[] = [];
  for (const probe of atsProbes(slug)) {
    const out = await fetch(probe.url, { sourceId: `ats-discover:${slug}`, accept: "application/json, application/xml;q=0.9, */*;q=0.5" });
    if (out.kind === "offline") return { hits, halted: out };
    if (out.kind !== "ok") continue;
    if (probe.looksRight(out.body)) hits.push({ adapter: probe.adapter, host: probe.host, config: probe.config });
  }
  return { hits, halted: null };
}
