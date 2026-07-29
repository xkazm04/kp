"use client";

import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { DECISION_META, kindLabel } from "@/app/_lib/decision-attribution";
import { Select } from "@/app/_components/Select";

// ANA5: isolate the rows you're answering for — attribution chips, a kind
// select, and a CSV export of exactly what's isolated. Split out of
// AnalyticsDecisionLog.tsx (formerly DecisionLog.tsx) to keep that file under
// the 200-line cap. print:hidden so the existing print pattern captures the
// log, not its chrome.
export function AnalyticsDecisionLogToolbar({
  attribution,
  kind,
  setAttribution,
  setKind,
  exportCsv,
  exportDisabled,
  relayConfigured,
}: {
  attribution: "auto" | "human" | null;
  kind: string;
  setAttribution: (a: "auto" | "human" | null) => void;
  setKind: (k: string) => void;
  exportCsv: () => void;
  exportDisabled: boolean;
  relayConfigured: boolean | null;
}) {
  const t = useTranslations("analytics.log");
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 print:hidden">
      {(["auto", "human"] as const).map((a) => (
        <button
          key={a}
          type="button"
          onClick={() => setAttribution(attribution === a ? null : a)}
          aria-pressed={attribution === a}
          disabled={Boolean(kind)}
          className={`focus-ring rounded-full border px-3 py-1 text-sm font-semibold transition-colors disabled:opacity-50 ${
            attribution === a ? "border-coral bg-coral/10 text-coral" : "border-stone-200 text-steel hover:border-coral/40"
          }`}
        >
          {t(`attribution.${a}`)}
        </button>
      ))}
      <Select
        value={kind}
        onChange={setKind}
        ariaLabel={t("filterKindAria")}
        size="sm"
        className="h-8"
        options={[
          { value: "", label: t("allKinds") },
          ...Object.keys(DECISION_META).map((k) => ({ value: k, label: kindLabel(t, k, { relayConfigured }) })),
        ]}
      />
      <button
        type="button"
        onClick={exportCsv}
        disabled={exportDisabled}
        className="focus-ring ml-auto inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white px-2.5 py-1 text-sm font-medium text-steel hover:bg-paper hover:text-ink disabled:opacity-50"
      >
        <Download size={12} aria-hidden /> {t("exportCsv")}
      </button>
    </div>
  );
}
