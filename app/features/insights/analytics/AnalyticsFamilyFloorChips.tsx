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
  const entries = Object.entries(familyFloors);
  return (
    <div className="mt-5 border-t border-stone-200 pt-4">
      <p className="text-meta uppercase tracking-wide text-steel">{t("familyFloorsTitle")}</p>
      <p className="mt-0.5 text-sm text-steel">{t("familyFloorsBlurb", { global: currentThreshold ?? 0 })}</p>
      {/* UAT KAT-ANA-6 — the seeded workspace has NO per-family override, and the
          panel answered that with an empty region. An absent override is a fact
          worth stating: every family is judged by the one global floor. */}
      {entries.length === 0 ? (
        <p className="mt-2 max-w-prose text-sm text-steel">{t("familyFloorsNone", { global: currentThreshold ?? 0 })}</p>
      ) : null}
      <ul className="mt-2 flex flex-wrap gap-2">
        {entries
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([fam, value]) => (
            <li key={fam}>
              <button
                type="button"
                // A TOGGLE, because `aria-pressed` says it is one. Selecting a chip
                // narrows the whole panel (curve, recommendation, sealed history) to
                // that family, and re-clicking the pressed chip used to do nothing —
                // the only way back to all roles was the header's family Select, which
                // is rendered only when the payload carries MORE THAN ONE family. A
                // workspace with one family and a per-family override could therefore
                // enter the family-scoped view and never leave it.
                onClick={() => setFamily(family === fam ? "" : fam)}
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
