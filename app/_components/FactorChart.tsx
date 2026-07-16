"use client";

import dynamic from "next/dynamic";
import type { Analysis } from "@/app/_lib/schemas";
import { Skeleton } from "@/app/_components/Skeleton";

// Re-exported so existing importers keep working; the contract lives in _lib so it can be
// unit-tested without loading recharts.
export { FACTOR_MAXES, FACTOR_DOMAIN, factorPoints, type FactorId, type FactorPoint } from "@/app/_lib/factor-points";

type FactorChartProps = {
  score: Analysis["score"];
};

// The score-breakdown chart lives on ExtractionTab, the DEFAULT tab of every non-comparison
// report — so recharts (the panel's heaviest dep) used to ship in the first report paint.
// The recharts-consuming body is split into FactorChartBody and loaded via `next/dynamic`,
// keeping recharts out of the initially-loaded client chunk. SSR is left ON (the default):
// the chart already prerendered as a client component, so this is a pure client code-split
// with no behavior change — recharts just arrives in its own on-demand chunk.
//
// The fallback mirrors the chart container's box (aspect-ratio 5/2, min-height 200) so the
// swap holds its space and never shifts layout; the Skeleton primitive owns the shimmer +
// reduced-motion + dual-theme treatment, so this reads correctly in both themes.
const FactorChartBody = dynamic(() => import("@/app/_components/FactorChartBody"), {
  loading: () => (
    <div style={{ aspectRatio: "5 / 2", minHeight: 200 }} className="w-full">
      <Skeleton className="h-full w-full rounded-lg" />
    </div>
  ),
});

export function FactorChart({ score }: FactorChartProps) {
  return <FactorChartBody score={score} />;
}
