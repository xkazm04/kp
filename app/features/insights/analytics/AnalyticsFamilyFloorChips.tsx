"use client";

import { useTranslations } from "next-intl";
import { labelize } from "@/app/_lib/format";

// family-floors — which families carry their own screening floor. Compact chips
// with the override value; selecting one drills into that family (its
// recommendation + its sealed history strip). Pipeline source only. Split out of
// AnalyticsCalibrationPanel.tsx (formerly CalibrationPanel.tsx) to keep that file
// under the 200-line cap.
export function AnalyticsFamilyFloorChips({
  familyFloors,
  currentThreshold,
  family,
  setFamily,
}: {
  familyFloors: Record<string, number>;
  currentThreshold: number | null;
  family: string;
  setFamily: (f: string) => void;
}) {
  const t = useTranslations("analytics.calibration");
  return (
    <div className="mt-5 border-t border-stone-200 pt-4">
      <p className="text-meta uppercase tracking-wide text-steel">{t("familyFloorsTitle")}</p>
      <p className="mt-0.5 text-sm text-steel">{t("familyFloorsBlurb", { global: currentThreshold ?? 0 })}</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {Object.entries(familyFloors)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([fam, value]) => (
            <li key={fam}>
              <button
                type="button"
                onClick={() => setFamily(fam)}
                aria-pressed={family === fam}
                className={`focus-ring inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-meta hover:border-coral/40 ${
                  family === fam ? "border-coral/50 bg-coral/10" : "border-stone-200 bg-paper/60"
                }`}
              >
                <span className="font-medium text-ink">{labelize(fam)}</span>
                <span className="rounded-full bg-stone-100 px-1.5 py-0.5 font-semibold text-steel">
                  {t("familyFloorValue", { value })}
                </span>
              </button>
            </li>
          ))}
      </ul>
    </div>
  );
}
