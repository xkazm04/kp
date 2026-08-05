"use client";

import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { AMBER, INK, MOSS, STEEL } from "../tokens";
import { useStillMotion } from "../useStillMotion";

/*
 * The recharts half of AuditArt, in its own module so `next/dynamic` can keep
 * recharts OUT of the landing page's initial chunk — the same lazy-boundary
 * split `app/_components/FactorChart.tsx` uses for the report panel. It is the
 * one genuinely quantitative claim on the marketing page ("confidence is
 * measured against real outcomes"), and it should not cost every visitor who
 * never opens the Responsible-AI tab a chart library.
 *
 * Illustrative figures, not copy and not live telemetry: what share of the
 * candidates we scored in each band went on to clear the human interview,
 * against what the score predicted. Bars of near-equal height mean the number
 * means what it says — which is the whole point, and readable without knowing
 * the word "calibration". Band labels are numeric data, so this module stays
 * free of translation plumbing; the legend and caption live in AuditArt.
 *
 * Stripped to the bone deliberately: no grid, no Y axis, no tooltip. The Spark
 * art direction is flat ink outlines, and default chart chrome fights it.
 */
const CALIBRATION = [
  { band: "50s", predicted: 55, actual: 51 },
  { band: "60s", predicted: 65, actual: 68 },
  { band: "70s", predicted: 75, actual: 72 },
  { band: "80s", predicted: 85, actual: 87 }
] as const;

export default function CalibrationChart() {
  const rm = useStillMotion();
  return (
    <div className="nums h-[80px] w-full sm:h-[96px]">
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
        <BarChart data={[...CALIBRATION]} margin={{ top: 4, right: 2, left: 2, bottom: 0 }} barGap={3}>
          <XAxis
            dataKey="band"
            tick={{ fill: STEEL, fontSize: 11, fontWeight: 700 }}
            tickLine={false}
            axisLine={{ stroke: INK, strokeWidth: 3 }}
          />
          {/* Both series are percentages, so the axis is 0-100 — recharts would
              otherwise fit the domain to the data and silently exaggerate the
              gaps this panel exists to show are SMALL. Hidden: the shared
              vertical scale matters, its ticks do not. */}
          <YAxis hide domain={[0, 100]} />
          <Bar dataKey="predicted" fill={AMBER} stroke={INK} strokeWidth={3} radius={[5, 5, 0, 0]} isAnimationActive={!rm} />
          <Bar dataKey="actual" fill={MOSS} stroke={INK} strokeWidth={3} radius={[5, 5, 0, 0]} isAnimationActive={!rm} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
