"use client";

// STUB (spark analyze-v2-cohort WP0): the final signature of the shared dimension page.
// WP4 replaces the body with the seven dimension-specific breakdowns; every world
// (WP5-7) descends into THIS component and must not fork it.
import { useTranslations } from "next-intl";
import type { DimensionPageProps } from "../cohortTypes";

export function DimensionPage({ dimension }: DimensionPageProps) {
  const t = useTranslations("analyzeCohort.dims");
  return <section data-cohort-dimension={dimension}>{t(dimension)}</section>;
}
