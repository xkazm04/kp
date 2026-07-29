"use client";

import { useTranslations } from "next-intl";
import { MotionizedGlyph } from "@/app/_components/glyph/MotionizedGlyph";
import { ANALYTICS_GLYPH } from "@/app/_components/glyph/glyphs/analyticsGlyph";
import { PANEL_SUNKEN, STAT_LABEL, STAT_VALUE } from "@/app/_components/ui/recipes";
import { UpstreamLinks, type AnalyticsEmptyProps } from "./AnalyticsEmptyShared";

// VARIANT A — "the readout, previewed".
//
// Metaphor: the report already exists; it is simply waiting for its first
// number. Instead of apologising for having no data, the empty state shows the
// three figures Analytics will hand back and what each one will let the
// recruiter decide. The glyph is deliberately SECONDARY here (a small mark
// beside the copy) — the promised metrics are the hero.
//
// Honesty rule, inherited from the rest of this tab (see the ROI ledger /
// forecast panels): nothing is fabricated. Every tile shows a literal em-dash,
// never a plausible-looking sample figure — a fake chart on an empty state is a
// lie the user only detects after trusting it once.

// The three figures this tab leads with once a single candidate exists. Kept as
// data (not markup) so the row is one map and the set is easy to re-order — each
// entry is a pair of `analytics.empty.*` catalog keys, resolved at render.
const PROMISED_METRICS: { labelKey: "metricHireRate" | "metricTimeToHire" | "metricCostPerHire"; meaningKey: "metricHireRateBody" | "metricTimeToHireBody" | "metricCostPerHireBody" }[] = [
  { labelKey: "metricHireRate", meaningKey: "metricHireRateBody" },
  { labelKey: "metricTimeToHire", meaningKey: "metricTimeToHireBody" },
  { labelKey: "metricCostPerHire", meaningKey: "metricCostPerHireBody" },
];

/** One promised-but-empty figure: label, an honest em-dash, and what it will mean. */
function MetricPreviewTile({ label, meaning, noValue }: { label: string; meaning: string; noValue: string }) {
  return (
    <div className="rounded-md border border-dashed border-stone-300 bg-white px-3 py-2.5 text-left">
      <p className={STAT_LABEL}>{label}</p>
      <p className={`mt-0.5 ${STAT_VALUE} text-stone-300`} aria-label={noValue}>
        —
      </p>
      <p className="mt-1 text-sm text-steel">{meaning}</p>
    </div>
  );
}

export function AnalyticsEmptyPreview({ title, body, links }: AnalyticsEmptyProps) {
  const t = useTranslations("analytics.empty");
  return (
    <div className={`${PANEL_SUNKEN} p-6 text-left`}>
      <div className="flex items-start gap-4">
        <MotionizedGlyph
          data={ANALYTICS_GLYPH.data}
          viewBox={ANALYTICS_GLYPH.viewBox}
          className="hidden h-20 w-20 shrink-0 sm:block"
        />
        <div className="min-w-0">
          <p className="text-base font-semibold text-ink">{title}</p>
          {body ? <p className="mt-1 max-w-xl text-sm text-steel">{body}</p> : null}
        </div>
      </div>

      <p className="mt-5 text-meta uppercase tracking-wide text-steel">{t("willReport")}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {PROMISED_METRICS.map((m) => (
          <MetricPreviewTile
            key={m.labelKey}
            label={t(m.labelKey)}
            meaning={t(m.meaningKey)}
            noValue={t("noValueYet")}
          />
        ))}
      </div>

      <UpstreamLinks links={links} className="mt-5" />
    </div>
  );
}
