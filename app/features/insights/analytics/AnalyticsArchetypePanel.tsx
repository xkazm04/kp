"use client";

import { useTranslations } from "next-intl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { ChainEmptyState } from "@/app/_components/ChainEmptyState";
import type { Analytics } from "./AnalyticsTypes";

// The "by archetype" advance-rate card in the Analytics tab's right column.
// Split out of AnalyticsTab.tsx to keep that file under the 200-line cap.
export function AnalyticsArchetypePanel({ byArchetype }: { byArchetype: Analytics["byArchetype"] }) {
  const t = useTranslations("analytics");
  const enumLabel = useEnumLabel();
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <h3 className="font-serif text-h2 text-ink">{t("byArchetype")}</h3>
      <ul className="mt-3 space-y-3">
        {byArchetype.map((a) => (
          <li key={a.archetype}>
            <div className="flex items-baseline justify-between text-base">
              <span className="font-medium text-ink">{enumLabel("archetype", a.archetype)}</span>
              <span className="text-steel">{t("totalHired", { total: a.total, hired: a.hired })}</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-paper">
              <div className="h-full rounded-full bg-steel/40" style={{ width: `${a.advanceRatePct}%` }} />
            </div>
            <p className="mt-0.5 text-sm text-steel">{t("advancedPct", { pct: a.advanceRatePct })}</p>
          </li>
        ))}
        {byArchetype.length === 0 ? (
          // Chain-aware, not a bare "no data yet": say what produces the
          // data and link the upstream step (matches the five other tabs).
          <li>
            <ChainEmptyState
              title={t("noArchetypeData")}
              body={t("noArchetypeBody")}
              links={[{ tab: "channels", label: t("emptyCtaChannels") }]}
            />
          </li>
        ) : null}
      </ul>
    </div>
  );
}
