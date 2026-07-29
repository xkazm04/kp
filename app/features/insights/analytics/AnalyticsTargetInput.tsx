"use client";

import { useTranslations } from "next-intl";
import { InlineNumberSave } from "./AnalyticsInlineNumberSave";

// One recruiter-set goal (a per-stage conversion %% or the recruiter hourly
// rate), persisted via /api/analytics/targets. Split out of AnalyticsTab.tsx to
// keep that file under the 200-line cap — shared by AnalyticsGoalsEditor.tsx and
// AnalyticsAutomationPanel.tsx's RoiLedger.
export function TargetInput({
  metric,
  label,
  value,
  suffix,
  onSaved,
}: {
  metric: string;
  label: string;
  value: number | null;
  suffix: string;
  onSaved: () => void;
}) {
  const t = useTranslations("analytics.goals");
  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor={`goal-${metric}`} className="w-28 shrink-0 text-steel">
        {label}
      </label>
      <InlineNumberSave
        id={`goal-${metric}`}
        value={value}
        width="w-20"
        inputType="number"
        failedTitle={t("saveFailed")}
        onSave={async (v) => {
          const r = await fetch("/api/analytics/targets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ metric, value: v }),
          });
          if (!r.ok) throw new Error();
          onSaved();
        }}
      />
      <span className="text-meta text-steel">{suffix}</span>
    </div>
  );
}
