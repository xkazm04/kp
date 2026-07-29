"use client";

import { useTranslations } from "next-intl";
import type { Delta } from "@/app/_lib/analytics-deltas";

// ce8e3c9e — a compact "+4 pts" / "−3 d" vs-previous chip. Green/coral keys off
// whether the change is an IMPROVEMENT (direction-aware: for time-to-hire, down
// is good), so the color reads as good/bad, not up/down. A null delta (no prior
// baseline, e.g. an empty previous window) renders nothing. Split out of
// AnalyticsTab.tsx to keep that file under the 200-line cap — reused by
// AnalyticsChannelEconomicsPanel.tsx, AnalyticsStatCluster.tsx and others.
export function DeltaChip({ delta, lowerIsBetter, unit }: { delta: Delta; lowerIsBetter?: boolean; unit?: "pts" | "days" }) {
  const t = useTranslations("analytics");
  if (delta.delta == null || delta.delta === 0) {
    return delta.delta === 0 ? <span className="text-meta text-steel">{t("deltaFlat")}</span> : null;
  }
  const improved = lowerIsBetter ? delta.delta < 0 : delta.delta > 0;
  const sign = delta.delta > 0 ? "+" : "−";
  const magnitude = Math.abs(delta.delta);
  const text =
    unit === "pts"
      ? t("deltaPts", { sign, n: magnitude })
      : unit === "days"
        ? t("deltaDays", { sign, n: magnitude })
        : `${sign}${magnitude}`;
  return (
    <span
      className={`rounded px-1 py-0.5 text-meta font-semibold ${improved ? "bg-moss/10 text-moss" : "bg-coral/10 text-coral"}`}
      title={t("deltaTitle")}
    >
      {text}
    </span>
  );
}
