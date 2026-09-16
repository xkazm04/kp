"use client";

import type { ExtractionRule, JobseekerSource, RuleDryRunResult } from "@/app/_lib/jobseeker/types";

// The Sources page's view of the API (app/api/jobseeker/sources/**). The catalog entry
// type mirrors sources-catalog.ts's CatalogEntry minus nothing: the route serves it
// verbatim. Declared here rather than imported because that module pulls node:crypto
// and this file ships to the browser.

export type CatalogEntryView = {
  id: string;
  host: string;
  tier: "A" | "B" | "C";
  adapter: string;
  kind: "feed" | "ats" | "board";
  label: string;
  robotsSummary: string;
  termsQuote: string;
  termsUrl: string;
  termsHash: string;
  cadenceNote: string;
  refusedReason: string | null;
  needsCompanyConfig: boolean;
  attribution: string | null;
  checkedOn: string;
};

export type SourcesPayload = { catalog: CatalogEntryView[]; sources: JobseekerSource[] };

export type PreviewItem = Record<string, unknown>;

export type PreviewResult = {
  outcome: "ok" | "empty" | "collapsed";
  url: string;
  perRule: RuleDryRunResult[];
  items: PreviewItem[];
  itemCount: number;
  baseline: Record<string, number>;
};

export type ProposeResult = PreviewResult & {
  rules: ExtractionRule[];
  source: "llm" | "deterministic";
  fallbackReason: string | null;
  invalid?: string;
};

export type ApiFailure = { code: string | null; termsHash?: string; reason?: string | null };

/** One JSON call; `ok` carries the parsed body, `fail` the code (plus the 409's termsHash). */
export async function callJson<T>(url: string, init?: RequestInit): Promise<{ ok: true; body: T } | { ok: false; fail: ApiFailure; status: number }> {
  try {
    const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
    const body = (await res.json().catch(() => null)) as (T & { code?: string; termsHash?: string; reason?: string | null }) | null;
    if (!res.ok || body === null) return { ok: false, fail: { code: body?.code ?? null, termsHash: body?.termsHash, reason: body?.reason }, status: res.status };
    return { ok: true, body };
  } catch {
    return { ok: false, fail: { code: null }, status: 0 };
  }
}

/** The catalog entry a stored source came from (exact host, else a parent domain for
 *  per-company ATS hosts), the same rule sources-catalog.ts applies server-side. */
export function entryForSource(catalog: CatalogEntryView[], source: JobseekerSource): CatalogEntryView | null {
  const h = source.host.toLowerCase();
  return catalog.find((e) => e.host === h) ?? catalog.find((e) => h.endsWith(`.${e.host}`)) ?? null;
}
