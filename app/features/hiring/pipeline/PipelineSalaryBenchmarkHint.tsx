"use client";

import { useTranslations } from "next-intl";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";

// Phase 2 (cross-company reference tier) — a market-band reference line for the offer
// draft: "for this role family, the corpus band is p25–p75 (median X)". Reads
// /api/benchmarks/salary (shared reference corpus, aggregate-only, min-cohort guarded).
// The parent only mounts this when a roleFamily is known, so the fetch URL is always valid.

type SalaryBenchmark = { currency: string; count: number; p25: number; median: number; p75: number };

export function SalaryBenchmarkHint({ roleFamily, seniority }: { roleFamily: string; seniority?: string | null }) {
  const t = useTranslations("pipeline.result");
  const url = `/api/benchmarks/salary?roleFamily=${encodeURIComponent(roleFamily)}${seniority ? `&seniority=${encodeURIComponent(seniority)}` : ""}`;
  const { data } = useJsonFetch<{ benchmark: SalaryBenchmark | null }>(url);
  // No data yet, or below the min-cohort floor (too few reference roles) → show nothing.
  if (!data?.benchmark) return null;
  const b = data.benchmark;
  const fmt = (n: number) => n.toLocaleString("en-US");
  return (
    <p className="rounded-md bg-paper px-2 py-1 text-micro text-steel">
      {t("marketBand", { min: fmt(b.p25), max: fmt(b.p75), median: fmt(b.median), currency: b.currency, count: b.count })}
    </p>
  );
}
