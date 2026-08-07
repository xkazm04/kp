"use client";

import { useTranslations } from "next-intl";
import type { CalibrationCohort } from "@/app/_lib/calibration";

// Direction 1 — drift: the same reliability, bucketed by calendar quarter. Each
// cohort is gated independently, so a recent quarter that slipped below the
// outcome floor reads "not enough yet" instead of borrowing the good all-time
// number. Brier lower = better, so a rising bar across quarters is a warning.
// Split out of CalibrationPanel.tsx (now AnalyticsCalibrationPanel.tsx) to keep
// that file under the 200-line cap.
export function DriftStrip({ cohorts }: { cohorts: CalibrationCohort[] }) {
  const t = useTranslations("analytics.calibration");
  const rated = cohorts.filter((c) => c.brier != null);
  const maxBrier = rated.reduce((m, c) => Math.max(m, c.brier as number), 0.25);
  return (
    <div className="mt-5 border-t border-stone-200 pt-4">
      <p className="text-meta uppercase tracking-wide text-steel">{t("driftTitle")}</p>
      <p className="mt-0.5 text-sm text-steel">{t("driftBlurb")}</p>
      <ol className="mt-3 flex flex-wrap gap-2">
        {cohorts.map((c) => {
          const gated = c.brier == null;
          const heightPct = gated ? 0 : Math.round(((c.brier as number) / maxBrier) * 100);
          return (
            <li
              key={c.key}
              className="flex min-w-[4.5rem] flex-1 flex-col items-center gap-1 rounded-md border border-stone-200 bg-paper/60 px-2 py-2"
              title={gated ? t("driftCohortPending") : t("driftBrierTitle", { brier: (c.brier as number).toFixed(3), n: c.n })}
            >
              <div className="flex h-12 w-full items-end justify-center" aria-hidden>
                {gated ? (
                  <span className="mb-1 text-meta text-steel">—</span>
                ) : (
                  <span className="w-3 rounded-t-sm bg-steel/50" style={{ height: `${Math.max(6, heightPct)}%` }} />
                )}
              </div>
              <span className="text-meta font-semibold text-ink">{c.key}</span>
              {gated ? (
                <span className="text-center text-meta leading-tight text-steel">{t("driftCohortPending")}</span>
              ) : (
                <>
                  <span className="text-sm font-semibold text-ink">{(c.brier as number).toFixed(3)}</span>
                  <span className="text-meta text-steel">{t("driftCohortN", { n: c.n })}</span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
