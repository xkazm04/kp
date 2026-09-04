"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useNumberFormat } from "@/app/_lib/use-number-format";
import { Download } from "lucide-react";
import { downloadFile, toCsv } from "@/app/_lib/export-utils";
import { kindLabel, type AutomationImpact } from "@/app/_lib/decision-attribution";
import type { AutomationRoi } from "@/app/_lib/automation-roi";
import { useDeliveryCapability } from "@/app/features/shell/useDeliveryCapability";
import { TargetInput } from "./AnalyticsTargetInput";
import { RECRUITER_HOURLY_KEY } from "./AnalyticsTypes";
import { PANEL } from "@/app/_components/ui/recipes";

// ANA3 — "how much is the automation actually doing": the auto/human split plus
// the rollup rows, all folded through the SAME decision-attribution map the
// DecisionLog badges use, over the page's selected window. Split out of
// AnalyticsTab.tsx to keep that file under the 200-line cap.
export function AutomationPanel({
  impact,
  roi,
  costPerHireCzk,
  timeToHireDays,
  onSaved,
  decisionsHref,
}: {
  impact: AutomationImpact;
  roi: AutomationRoi;
  costPerHireCzk: number | null;
  timeToHireDays: number | null;
  onSaved: () => void;
  decisionsHref: string;
}) {
  const t = useTranslations("analytics.automation");
  // REC-10 — "Comms delivered" is only claimed when a relay delivers; without
  // one the same count is truthfully "recorded in Outbox".
  const relayConfigured = useDeliveryCapability();
  const decided = impact.autoCount + impact.humanCount;
  const pct = decided > 0 ? Math.round((impact.autoCount / decided) * 100) : null;
  return (
    <div className={`${PANEL} p-5`}>
      <h3 className="font-serif text-h2 text-ink">{t("title")}</h3>
      {pct == null ? (
        <p className="mt-3 text-base text-steel">{t("empty")}</p>
      ) : (
        <>
          <p className="mt-2 font-serif text-display leading-none text-ink">{t("headline", { pct })}</p>
          <p className="mt-1 text-sm text-steel">{t("split", { auto: impact.autoCount, human: impact.humanCount })}</p>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-paper" aria-hidden>
            <div className="h-full rounded-full bg-moss/60" style={{ width: `${pct}%` }} />
          </div>
          <ul className="mt-4 space-y-1.5 text-base">
            <ImpactRow label={t("autoAdvanced")} value={impact.autoAdvanced} />
            <ImpactRow label={t("autoRejected")} value={impact.autoRejected} />
            <li className="flex items-baseline justify-between gap-2">
              <span className="text-steel">{t("holds")}</span>
              {/* Holds are acted on in the Decisions queue — the figure links to
                  where the action happens, like the funnel bars do (ANA1). */}
              <Link
                href={decisionsHref}
                title={t("reviewHolds")}
                className="focus-ring rounded font-medium text-ink underline-offset-2 hover:text-coral hover:underline"
              >
                {t("holdsValue", { raised: impact.holdsRaised, resolved: impact.holdsResolved })}
              </Link>
            </li>
            <ImpactRow label={t(relayConfigured === false ? "commsQueued" : "comms")} value={impact.commsDelivered} />
          </ul>
          {/* b39992b1 — what that automation was WORTH, in recruiter-hours + CZK. */}
          <RoiLedger roi={roi} costPerHireCzk={costPerHireCzk} timeToHireDays={timeToHireDays} onSaved={onSaved} />
        </>
      )}
    </div>
  );
}

// b39992b1 — the counterfactual savings the automated trail bought, grounded in
// the same per-kind event counts the rollup uses, at the org's (override-able)
// hourly rate. Exportable like the decision log.
function RoiLedger({
  roi,
  costPerHireCzk,
  timeToHireDays,
  onSaved,
}: {
  roi: AutomationRoi;
  costPerHireCzk: number | null;
  timeToHireDays: number | null;
  onSaved: () => void;
}) {
  const t = useTranslations("analytics.roi");
  const tLog = useTranslations("analytics.log");
  // These CZK figures sit inside localized sentences, so they group in the
  // READER's locale rather than a hardcoded cs-CZ (format.ts number-locale contract).
  const { grouped } = useNumberFormat();
  // REC-10 — the ledger's per-kind rows reuse the event-kind labels; with no
  // relay a "…sent" kind renders its honest queued variant here too.
  const relayConfigured = useDeliveryCapability();
  const exportCsv = () => {
    downloadFile(
      "kp-automation-roi.csv",
      toCsv([
        // Leadership readout first (UAT M7) — the three figures a TA lead defends
        // upward — then the per-kind ledger they roll up from.
        [t("csvMetric"), t("csvValue")],
        [t("rdTimeSaved"), roi.pctOfManualBaseline != null ? `${roi.pctOfManualBaseline}%` : "—"],
        [t("csvHoursPerHire"), roi.hoursSavedPerHire ?? "—"],
        [t("rdCostPerHire"), costPerHireCzk ?? "—"],
        [t("rdTimeToHire"), timeToHireDays ?? "—"],
        [t("csvHoursTotal"), roi.hoursSaved],
        [t("csvCzkTotal"), roi.czkSaved],
        [],
        [t("csvKind"), t("csvCount"), t("csvMinsEach"), t("csvMinsTotal")],
        ...roi.actions.map((a) => [kindLabel(tLog, a.kind, { relayConfigured }), a.count, a.minutesEach, a.minutesTotal]),
      ]),
      "text/csv"
    );
  };
  return (
    <div className="mt-4 border-t border-stone-200 pt-3">
      <h4 className="text-meta uppercase tracking-wide text-steel">{t("title")}</h4>
      {roi.totalActions === 0 ? (
        <p className="mt-1 text-sm text-steel">{t("empty")}</p>
      ) : (
        <>
          <p className="mt-1 font-serif text-h2 leading-tight text-moss">
            {t("headline", { hours: roi.hoursSaved, czk: grouped(roi.czkSaved) })}
          </p>
          {/* Measured against the manual baseline (UAT M7): a reduction a leader can
              size, not a bare hour count. Honest "pending" until there's a hire. */}
          {roi.hoursSavedPerHire != null ? (
            <p className="mt-0.5 text-sm font-medium text-moss">
              {t("perHire", { hours: roi.hoursSavedPerHire, pct: roi.pctOfManualBaseline ?? 0, baseline: roi.manualBaselineHoursPerHire })}
            </p>
          ) : (
            <p className="mt-0.5 text-sm text-steel">{t("perHirePending")}</p>
          )}
          <p className="mt-0.5 text-sm text-steel">{t("basis", { actions: roi.totalActions, rate: roi.hourlyRateCzk })}</p>

          {/* Leadership readout (UAT M7): savings-vs-baseline + cost-per-hire +
              time-to-hire — the three scattered numbers, in one defensible place. */}
          <dl className="mt-3 grid grid-cols-3 gap-3 rounded-md bg-paper p-3">
            <div>
              <dt className="text-meta uppercase tracking-wide text-steel">{t("rdTimeSaved")}</dt>
              <dd className="mt-0.5 font-serif text-h3 text-ink">{roi.pctOfManualBaseline != null ? `${roi.pctOfManualBaseline}%` : "—"}</dd>
              <dd className="text-micro text-steel">{roi.hoursSavedPerHire != null ? t("rdPerHireSub", { hours: roi.hoursSavedPerHire }) : t("rdNoHires")}</dd>
            </div>
            <div>
              <dt className="text-meta uppercase tracking-wide text-steel">{t("rdCostPerHire")}</dt>
              <dd className="mt-0.5 font-serif text-h3 text-ink">{costPerHireCzk != null ? t("czkValue", { n: grouped(costPerHireCzk) }) : "—"}</dd>
              <dd className="text-micro text-steel">{t("rdAllTime")}</dd>
            </div>
            <div>
              <dt className="text-meta uppercase tracking-wide text-steel">{t("rdTimeToHire")}</dt>
              <dd className="mt-0.5 font-serif text-h3 text-ink">{timeToHireDays != null ? t("daysValue", { n: timeToHireDays }) : "—"}</dd>
              {/* Labeled "median" — so the ROI ledger is now fed the true
                  medianTimeToHireDays, not the mean (analytics-calibration-dashboards #1). */}
              <dd className="text-micro text-steel">{t("rdMedian")}</dd>
            </div>
          </dl>

          <ul className="mt-3 space-y-1 text-sm">
            {roi.actions.slice(0, 5).map((a) => (
              <li key={a.kind} className="flex items-baseline justify-between gap-2">
                <span className="truncate text-steel">{t("actionRow", { label: kindLabel(tLog, a.kind, { relayConfigured }), count: a.count })}</span>
                <span className="shrink-0 font-medium text-ink">{t("minsSaved", { mins: a.minutesTotal })}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <TargetInput
              metric={RECRUITER_HOURLY_KEY}
              label={t("rateLabel")}
              value={roi.hourlyRateCzk}
              suffix={t("rateSuffix")}
              onSaved={onSaved}
            />
            <button
              type="button"
              onClick={exportCsv}
              className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 px-2.5 text-sm font-semibold text-ink hover:border-coral/40"
            >
              <Download size={13} /> {t("export")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ImpactRow({ label, value }: { label: string; value: number }) {
  return (
    <li className="flex items-baseline justify-between gap-2">
      <span className="text-steel">{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </li>
  );
}
