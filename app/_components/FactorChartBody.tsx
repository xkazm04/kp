"use client";

import { useTranslations } from "next-intl";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Analysis } from "@/app/_lib/schemas";
import { scoreTone, scoreToneColor } from "@/app/_lib/format";
import { DARK, INK, STEEL } from "@/app/_lib/brand";
import { useTheme } from "@/app/_components/ui/useTheme";
import { factorPoints, FACTOR_DOMAIN, type FactorId } from "@/app/_lib/factor-points";

// The recharts-consuming body of FactorChart, split into its own module so `next/dynamic`
// can code-split recharts (the heaviest dep in the report panel) OUT of the initially-loaded
// chunk. FactorChart.tsx is the lazy boundary; this file is loaded on demand. Nothing here
// changed from the prior inline implementation except the file it lives in — the wrapper
// keeps the same props and the same factor-points re-exports.

type FactorChartBodyProps = {
  score: Analysis["score"];
};

// Localized axis-label key per factor id (i18n preserved from the prior wave).
// `as const` matters: next-intl's `t()` rejects a widened `string` key, so the map's
// values must stay a literal union (the repo's standing template-literal-key gotcha).
const FACTOR_LABEL_KEYS = {
  experience: "factorExperience",
  skills: "factorSkills",
  role: "factorRole",
  education: "factorEducation",
  traits: "factorTraits",
} as const satisfies Record<FactorId, string>;

// Mirror the score->color language used by ScoreBadge and ScoreDial so a bar's
// height AND hue both encode fit: weak when a factor fills little of its max, mid
// in the middle, strong when it lands near the top. The fill resolves through the
// shared --color-score-* scale (scoreTone owns the 75/50 cutoffs) and recharts
// passes it straight to the SVG fill attribute, which accepts the var() — so the
// bars are guaranteed to match the badge/dial instead of tracking a parallel hex.
function barColor(ratio: number): string {
  return scoreToneColor(scoreTone(ratio * 100));
}

// Recharts wants literal color strings for its chrome (grid, ticks, tooltip),
// so the chart can't ride the CSS token seam like the bar fills do — it forks
// on useTheme() instead (the behavioral-fork layer in docs/design/README.md). Values
// mirror the light beiges / dark hairlines the rest of the UI resolves to.
const CHROME = {
  light: { grid: "#ded6c6", tick: STEEL, cursor: "#f0ebe1", tooltipBg: "#ffffff", tooltipText: INK },
  dark: { grid: DARK.GRID, tick: DARK.STEEL, cursor: DARK.FILL, tooltipBg: DARK.SURFACE, tooltipText: DARK.INK },
} as const;

export default function FactorChartBody({ score }: FactorChartBodyProps) {
  const chrome = CHROME[useTheme()];
  const t = useTranslations("report");
  // Stable `id` keys the Cells (locale-independent); `factor` is the localized axis
  // label; `ratio` (value/max in [0,1]) is what the bar height encodes so bars are
  // comparable across factors AND across candidates. Raw `value`/`max` ride along
  // for the tooltip.
  const data = factorPoints(score).map((p) => ({ ...p, factor: t(FACTOR_LABEL_KEYS[p.id]) }));

  // Recharts logs a "width(-1) / height(-1)" warning on the first render pass
  // before its internal ResizeObserver has measured the parent. We've tried
  // explicit min dims, aspect prop, deferred mount, and aspect-ratio parent —
  // none silence it because it fires before our parent measurement reaches
  // the chart. The warning is dev-mode-only and the chart renders correctly.
  return (
    <div style={{ aspectRatio: "5 / 2", minHeight: 200 }} className="w-full nums">
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
        <BarChart data={data} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
          <CartesianGrid stroke={chrome.grid} vertical={false} />
          <XAxis dataKey="factor" tick={{ fill: chrome.tick, fontSize: 12 }} tickLine={false} axisLine={false} />
          <YAxis
            domain={[FACTOR_DOMAIN[0], FACTOR_DOMAIN[1]]}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
            tick={{ fill: chrome.tick, fontSize: 12 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            cursor={{ fill: chrome.cursor }}
            contentStyle={{
              border: `1px solid ${chrome.grid}`,
              borderRadius: 8,
              color: chrome.tooltipText,
              backgroundColor: chrome.tooltipBg
            }}
            // Bars encode the ratio, but the tooltip shows the TRUE raw figure "N/max"
            // (from the payload), so height/color and the number tell one story.
            formatter={(_value, _name, item) => [`${item.payload.value}/${item.payload.max}`, t("factorPoints")]}
          />
          <Bar dataKey="ratio" radius={[6, 6, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.id} fill={barColor(d.ratio)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
