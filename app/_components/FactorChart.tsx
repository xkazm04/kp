"use client";

import { useTranslations } from "next-intl";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Analysis } from "@/app/_lib/schemas";
import { scoreTone, scoreToneColor } from "@/app/_lib/format";
import { DARK, INK, STEEL } from "@/app/_lib/brand";
import { useTheme } from "@/app/_components/ui/useTheme";

type FactorChartProps = {
  score: Analysis["score"];
};

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
// on useTheme() instead (the behavioral-fork layer in docs/DESIGN.md). Values
// mirror the light beiges / dark hairlines the rest of the UI resolves to.
const CHROME = {
  light: { grid: "#ded6c6", tick: STEEL, cursor: "#f0ebe1", tooltipBg: "#ffffff", tooltipText: INK },
  dark: { grid: DARK.GRID, tick: DARK.STEEL, cursor: DARK.FILL, tooltipBg: DARK.SURFACE, tooltipText: DARK.INK },
} as const;

export function FactorChart({ score }: FactorChartProps) {
  const chrome = CHROME[useTheme()];
  const t = useTranslations("report");
  // Stable `id` keys the Cells (locale-independent); `factor` is the localized axis label.
  const data = [
    { id: "experience", factor: t("factorExperience"), value: score.experience, max: 25 },
    { id: "skills", factor: t("factorSkills"), value: score.skills, max: 30 },
    { id: "role", factor: t("factorRole"), value: score.roleSeniority, max: 23 },
    { id: "education", factor: t("factorEducation"), value: score.education, max: 12 },
    { id: "traits", factor: t("factorTraits"), value: score.traits, max: 10 },
  ];

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
          <YAxis tick={{ fill: chrome.tick, fontSize: 12 }} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ fill: chrome.cursor }}
            contentStyle={{
              border: `1px solid ${chrome.grid}`,
              borderRadius: 8,
              color: chrome.tooltipText,
              backgroundColor: chrome.tooltipBg
            }}
            formatter={(value, _name, item) => [`${value}/${item.payload.max}`, t("factorPoints")]}
          />
          <Bar dataKey="value" radius={[6, 6, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.id} fill={barColor(d.value / d.max)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
