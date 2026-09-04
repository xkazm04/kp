"use client";

import type { Delta } from "@/app/_lib/analytics-deltas";
import { DeltaChip } from "./AnalyticsDeltaChip";
import { META_LABEL } from "@/app/_components/ui/recipes";

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
  //
  // `missed: null` = NOT MEASURED, and it is not the same as "met". The copy behind
  // `text` is only „goal 30 d" — no verdict word — so the colour IS the verdict, and
  // moss over a figure that does not exist reads as a goal being cleared. A window
  // with no hires renders "—" beside this pill, and it wore the met colour. Grey is
  // the tab's own answer for an unjudged number (analytics.briefNoGoalNote:
  // "Stages without a goal stay grey: a reading, not a verdict"), so an unmeasured
  // figure wears it too.
  goalChip?: { text: string; missed: boolean | null };
}) {
  return (
    <div className="bg-white px-4 py-2.5">
      <p className={META_LABEL}>{label}</p>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <p className="font-serif text-h2 leading-none text-ink">{value}</p>
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
