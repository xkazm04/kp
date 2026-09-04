"use client";

import { useTranslations } from "next-intl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { ChainEmptyState } from "@/app/_components/ChainEmptyState";
import type { Analytics } from "./AnalyticsTypes";
import { PANEL } from "@/app/_components/ui/recipes";

// The "by archetype" advance-rate card: which candidate profiles actually get
// through. Split out of AnalyticsTab.tsx to keep that file under the 200-line cap.
//
// UAT KAT-ANA-3 / TOM-ANA-2 — verdict RESTORE, not delete. Every other orphan this
// drain adjudicated had a consolidated surface that genuinely superseded it (the
// funnel band, the economics board); this one had none. The section split simply
// stopped importing it, and `byArchetype` has been computed on every request ever
// since with no reader — the state item 11 forbids. It belongs beside the by-role
// table in the Performance brief: same question ("who is carrying this pipeline"),
// asked of candidate profiles instead of roles.
export function AnalyticsArchetypePanel({ byArchetype }: { byArchetype: Analytics["byArchetype"] }) {
  const t = useTranslations("analytics");
  const enumLabel = useEnumLabel();
  return (
    <div className={`${PANEL} p-5`}>
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
