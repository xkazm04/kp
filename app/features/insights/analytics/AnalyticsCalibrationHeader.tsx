"use client";

import { useTranslations } from "next-intl";
import { labelize } from "@/app/_lib/format";
import { Select } from "@/app/_components/Select";

// The calibration panel's title/blurb + source/family selectors. Split out of
// AnalyticsCalibrationPanel.tsx (formerly CalibrationPanel.tsx) to keep that
// file under the 200-line cap.
export function AnalyticsCalibrationHeader({
  source,
  setSource,
  family,
  setFamily,
  families,
}: {
  source: "pipeline" | "analysis";
  setSource: (s: "pipeline" | "analysis") => void;
  family: string;
  setFamily: (f: string) => void;
  families: string[];
}) {
  const t = useTranslations("analytics.calibration");
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 className="font-serif text-h2 text-ink">{t("title")}</h3>
        <p className="mt-1 max-w-prose text-sm text-stone-500">{t("blurb")}</p>
        {/* What this curve measures — the score + the outcome, explicit. */}
        <p className="mt-1 max-w-prose text-sm font-medium text-stone-600">
          {source === "analysis" ? t("measuresAnalysis") : t("measuresPipeline")}
        </p>
        {/* Direction 1 — the label-exclusion note: what counts as an outcome and
            what is silently excluded, so the curve never over-claims its base. */}
        <p className="mt-1 max-w-prose text-sm text-steel">
          <span className="font-medium text-steel">{t("exclusionTitle")}</span>{" "}
          {source === "analysis" ? t("exclusionAnalysis") : t("exclusionPipeline")}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Select
          value={source}
          onChange={(v) => {
            setSource(v === "analysis" ? "analysis" : "pipeline");
            setFamily(""); // families differ per source — a stale filter would silently empty the curve
          }}
          ariaLabel={t("sourceLabel")}
          size="sm"
          className="shrink-0"
          options={[
            { value: "pipeline", label: t("sourcePipeline") },
            { value: "analysis", label: t("sourceAnalysis") },
          ]}
        />
        {families.length > 1 ? (
          <Select
            value={family}
            onChange={setFamily}
            ariaLabel={t("familyLabel")}
            size="sm"
            className="shrink-0"
            options={[{ value: "", label: t("familyAll") }, ...families.map((f) => ({ value: f, label: labelize(f) }))]}
          />
        ) : null}
      </div>
    </div>
  );
}
