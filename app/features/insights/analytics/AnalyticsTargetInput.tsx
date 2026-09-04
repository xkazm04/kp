"use client";

import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { localizedSaveFailure } from "./analyticsSaveFailure";
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
  // The route answers a refused or failed write with a CODE — ANALYTICS_POLICY_FORBIDDEN
  // (403, the seat may not run recruiter operations) or ANALYTICS_TARGET_SAVE_FAILED
  // (500, the write fell over). This editor threw a bare `new Error()` for both, so the
  // goal lines every figure on this tab is judged against could vanish behind one coral
  // border and one keyboard-unreachable tooltip. Same fold as the spend input beside it
  // (analyticsSaveFailure.ts), resolved HERE where the hook lives and thrown as an
  // already-localized failure the input renders verbatim.
  const errMsg = useErrorMessage();
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
        // A goal that did not save is announced, not only painted: the reader walks
        // away believing the board is now judged against a number nobody stored.
        announceFailure
        onSave={async (v) => {
          const r = await fetch("/api/analytics/targets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ metric, value: v }),
          });
          if (!r.ok) throw await localizedSaveFailure(r, errMsg, t("saveFailed"));
          onSaved();
        }}
      />
      <span className="text-meta text-steel">{suffix}</span>
    </div>
  );
}
