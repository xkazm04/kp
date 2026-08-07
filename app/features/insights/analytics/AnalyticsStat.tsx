"use client";

import type { Delta } from "@/app/_lib/analytics-deltas";
import { DeltaChip } from "./AnalyticsDeltaChip";

// One tile of the Analytics header's compact key-stat cluster. Split out of
// AnalyticsTab.tsx to keep that file under the 200-line cap.
export function Stat({
  label,
  value,
  sub,
  delta,
  lowerIsBetter,
  unit,
  goalChip,
}: {
  label: string;
  value: string | number;
  sub?: string;
  delta?: Delta;
  // For time-to-hire a smaller number is the win, so a negative delta is good.
  lowerIsBetter?: boolean;
  unit?: "pts" | "days";
  // 82c2b8e8 — a "goal Nd" pill, coral when the figure misses the goal.
  goalChip?: { text: string; missed: boolean };
}) {
  return (
    <div className="bg-white px-4 py-2.5">
      <p className="text-meta uppercase text-steel">{label}</p>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <p className="font-serif text-h2 leading-none text-ink">{value}</p>
        {delta ? <DeltaChip delta={delta} lowerIsBetter={lowerIsBetter} unit={unit} /> : null}
        {goalChip ? (
          <span className={`rounded px-1 py-0.5 text-meta font-semibold ${goalChip.missed ? "bg-coral/10 text-coral" : "bg-moss/10 text-moss"}`}>
            {goalChip.text}
          </span>
        ) : null}
      </div>
      {sub ? <p className="mt-0.5 text-sm text-steel">{sub}</p> : null}
    </div>
  );
}
