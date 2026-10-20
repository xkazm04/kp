// Which config key names the company on a per-company ATS source - ONE map, pure (no
// imports but types), so the create route, the two UI forms and the display label read
// the same answer. The adapters themselves read these keys (adapters/registry.ts
// hostForAdapter, adapters/ats/*.ts).
//
// Why it exists: both UI forms sent `config: { slug }`, which no adapter reads, so every
// company board added from /me failed its create with 400 JOBSEEKER_RULES_INVALID (found
// by the live e2e, e2e/jobseeker-live.spec.ts, 2026-09-28) - and the label read only
// `slug`, so a board created with the right key showed no company at all.

import type { SourceAdapterName } from "./types";

export const COMPANY_CONFIG_KEY: Partial<Record<SourceAdapterName, string>> = {
  ats_greenhouse: "token",
  ats_lever: "site",
  ats_ashby: "board",
  ats_workable: "subdomain",
  ats_recruitee: "company",
  ats_teamtailor: "company",
  ats_personio: "company",
  ats_smartrecruiters: "company",
};

/** The config a company form should send: the company under the adapter's own key. */
export function companyConfigFor(adapter: SourceAdapterName, company: string): Record<string, string> {
  const key = COMPANY_CONFIG_KEY[adapter];
  const value = company.trim();
  return key ? { [key]: value } : { slug: value };
}

/** A config as it arrived, with a legacy `slug` moved onto the adapter's key when that key
 *  is missing (an older client). Any other field is kept as sent. */
export function withCompanyKey(adapter: SourceAdapterName, config: Record<string, unknown>): Record<string, unknown> {
  const key = COMPANY_CONFIG_KEY[adapter];
  if (!key || (typeof config[key] === "string" && (config[key] as string).trim())) return config;
  const { slug, ...rest } = config;
  return typeof slug === "string" && slug.trim() ? { ...rest, [key]: slug.trim() } : config;
}

/** The company a source names, whichever key it was stored under; null when none. */
export function companyOf(adapter: SourceAdapterName, config: Record<string, unknown>): string | null {
  const key = COMPANY_CONFIG_KEY[adapter];
  const value = (key ? config[key] : undefined) ?? config.slug;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
