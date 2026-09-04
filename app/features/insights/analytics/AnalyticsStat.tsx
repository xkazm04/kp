"use client";

import type { Delta } from "@/app/_lib/analytics-deltas";
import { DeltaChip } from "./AnalyticsDeltaChip";
import { META_LABEL, STAT_VALUE } from "@/app/_components/ui/recipes";
import type { GoalChip } from "./statGoalChip";

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
  // 82c2b8e8 — a "goal Nd" pill, coral when the figure misses the goal, moss when it
  // meets it, GREY when nothing was measured. The verdict itself is `timeToHireGoalChip`
  // (statGoalChip.ts), pinned by statGoalChip.test.ts — this tile only paints it.
  goalChip?: GoalChip;
}) {
  return (
    <div className="bg-white px-4 py-2.5">
      <p className={META_LABEL}>{label}</p>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        {/* STAT_VALUE, not a re-typed copy of it: the hand-typed string had drifted
            off the recipe already (it lost `nums`, so these figures did not sit on
            tabular numerals and the cluster's columns jittered as the numbers moved). */}
        <p className={`${STAT_VALUE} text-ink`}>{value}</p>
        {delta ? <DeltaChip delta={delta} lowerIsBetter={lowerIsBetter} unit={unit} /> : null}
        {goalChip ? (
          <span
            className={`rounded px-1 py-0.5 text-meta font-semibold ${
              goalChip.missed == null ? "bg-stone-100 text-steel" : goalChip.missed ? "bg-coral/10 text-coral" : "bg-moss/10 text-moss"
            }`}
          >
            {goalChip.text}
          </span>
        ) : null}
      </div>
      {sub ? <p className="mt-0.5 text-sm text-steel">{sub}</p> : null}
    </div>
  );
}
