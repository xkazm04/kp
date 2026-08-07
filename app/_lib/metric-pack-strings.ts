import { namespaceTranslator } from "./catalog-translator";
import { isLocale, DEFAULT_LOCALE } from "@/i18n/locales";
import { buildMetricPackStrings, type MetricPackStrings } from "./metric-pack";

// F15 — the catalog loader for the downloadable hiring metric pack.
//
// WHY IT IS ITS OWN MODULE: metric-pack.ts is a pure builder that takes its copy as
// a parameter (the shape rule in docs/architecture/localization.md) and must keep
// loading under `node --test` with no catalog and no request scope. Keeping the
// loader here is what preserves that.
//
// UI-USER, not document-reader: the pack has no stored form and no language field —
// it is computed for the request that asked for it and streamed straight back as an
// attachment. The reader is whoever pressed Download, so the language is the
// request's (`getServerLocale()` in app/api/analytics/metric-pack/route.ts). The
// locale-pinned translator is used only because a route handler is outside React,
// not because the artifact carries a language of its own.

/** The metric pack's copy in `locale` (anything unsupported falls back to English). */
export async function metricPackStrings(locale: string | null | undefined): Promise<MetricPackStrings> {
  const t = await namespaceTranslator(isLocale(locale) ? locale : DEFAULT_LOCALE, "analytics.metricPack");
  return buildMetricPackStrings(t);
}
