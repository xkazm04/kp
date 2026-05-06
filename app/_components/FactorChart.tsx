"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Analysis } from "@/app/_lib/schemas";

type FactorChartProps = {
  score: Analysis["score"];
};

export function FactorChart({ score }: FactorChartProps) {
  const data = [
    { factor: "Experience", value: score.experience, max: 25 },
    { factor: "Skills", value: score.skills, max: 30 },
    { factor: "Role", value: score.roleSeniority, max: 23 },
    { factor: "Education", value: score.education, max: 12 },
    { factor: "Traits", value: score.traits, max: 10 }
  ];

  // Recharts logs a "width(-1) / height(-1)" warning on the first render pass
  // before its internal ResizeObserver has measured the parent. We've tried
  // explicit min dims, aspect prop, deferred mount, and aspect-ratio parent —
  // none silence it because it fires before our parent measurement reaches
  // the chart. The warning is dev-mode-only and the chart renders correctly.
  return (
    <div style={{ aspectRatio: "5 / 2", minHeight: 200 }} className="w-full">
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
        <BarChart data={data} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
          <CartesianGrid stroke="#ded6c6" vertical={false} />
          <XAxis dataKey="factor" tick={{ fill: "#42606f", fontSize: 12 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fill: "#42606f", fontSize: 12 }} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ fill: "#f0ebe1" }}
            contentStyle={{ border: "1px solid #ded6c6", borderRadius: 8, color: "#17202a" }}
            formatter={(value, _name, item) => [`${value}/${item.payload.max}`, "Points"]}
          />
          <Bar dataKey="value" radius={[6, 6, 0, 0]} fill="#526b4f" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
