"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { labelize } from "@/app/_lib/format";
import type { ThresholdRecommendation } from "@/app/_lib/calibration";

// Direction 3 + family-floors — the recommendation. Deterministic, honesty-gated,
// display-only until an explicit click routes the write through the existing
// decision-config mechanism (and seals a reversible record). Never auto-applied.
//
// APPLIABILITY: the screening floor is now per-family-capable. On the all-families
// view the apply moves the GLOBAL `maxMatchToReject`; under a family filter it writes
// THAT family's bounded override (familyFloors[family]). The write is re-derived
// server-side against the SAME scope the panel showed — so the 409 staleness guard is
// honest in both cases and neither is a dead-end. `roleFamily` ("" = global) threads
// straight to the route; the recommendation's `currentThreshold` already reflects the
// scope's effective floor, so the sentence reads correctly either way.
//
// Split out of CalibrationPanel.tsx (now AnalyticsCalibrationPanel.tsx) to keep that
// file under the 200-line cap.
export function ThresholdSuggestion({
  rec,
  roleFamily,
  onApplied,
}: {
  rec: ThresholdRecommendation;
  roleFamily: string; // "" = global floor; a family slug = that family's override
  onApplied: () => void;
}) {
  const t = useTranslations("analytics.calibration");
  const [phase, setPhase] = useState<"idle" | "applying" | "done" | "error">("idle");
  const [applied, setApplied] = useState<{ previous: number; next: number } | null>(null);

  const apply = async () => {
    setPhase("applying");
    try {
      const r = await fetch("/api/analytics/calibration/apply-threshold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestedThreshold: rec.suggestedThreshold, ...(roleFamily ? { roleFamily } : {}) }),
      });
      if (!r.ok) throw new Error();
      const body = (await r.json()) as { previousThreshold: number; newThreshold: number };
      setApplied({ previous: body.previousThreshold, next: body.newThreshold });
      setPhase("done");
      onApplied();
    } catch {
      setPhase("error");
    }
  };

  const sentence = rec.direction === "lower" ? "recLower" : "recRaise";
  // Always the actionable amber suggestion now — the family view can act on its own
  // bounded floor, so there is no dead-end informational card any more.
  return (
    <div className="mt-5 rounded-md border border-dial-amber/40 bg-dial-amber/10 p-3">
      <div className="flex items-center gap-2">
        <span className="rounded bg-dial-amber/20 px-1.5 py-0.5 text-meta font-semibold uppercase tracking-wide text-ink">
          {t("recTag")}
        </span>
        {roleFamily ? (
          <span className="rounded bg-stone-100 px-1.5 py-0.5 text-meta font-semibold uppercase tracking-wide text-steel">
            {t("recFamilyScope", { family: labelize(roleFamily) })}
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 text-base text-ink">
        {t(sentence, {
          lo: rec.band.lo,
          hi: rec.band.hi,
          pct: rec.advanceRatePct,
          n: rec.n,
          current: rec.currentThreshold,
          suggested: rec.suggestedThreshold,
        })}
      </p>
      <p className="mt-1 text-sm text-steel">{t("recBasis", { total: rec.totalOutcomes })}</p>
      {phase === "done" && applied ? (
        <p className="mt-2 text-sm font-medium text-moss" role="status">
          {roleFamily
            ? t("recAppliedFamily", { family: labelize(roleFamily), suggested: applied.next, previous: applied.previous })
            : t("recApplied", { suggested: applied.next, previous: applied.previous })}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={apply}
            disabled={phase === "applying"}
            className="focus-ring inline-flex h-8 items-center rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
          >
            {phase === "applying" ? t("recApplying") : t("recApply", { suggested: rec.suggestedThreshold })}
          </button>
          {phase === "error" ? (
            <span className="text-sm text-coral" role="alert">
              {t("recError")}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
