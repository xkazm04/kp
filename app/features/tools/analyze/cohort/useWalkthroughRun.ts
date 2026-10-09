"use client";

// The walkthrough's simulated clock: the comparison as it stands `at` ms after Start, advanced
// by one timeout per beat of the plan (simSchedule), every timeout cleared on unmount or when
// the plan changes — no stray timers. Reduced motion has no beats at all: the plan lands
// everyone at once and the run is done on the first draw.
import { useEffect, useMemo, useState } from "react";
import type { CohortView } from "./cohortTypes";
import { planFor, simView, type SimPlan, type WalkthroughRun } from "./cohortWalkthroughModel";

export function useWalkthroughRun(run: WalkthroughRun, reducedMotion: boolean): CohortView {
  const plan = useMemo(() => planFor(run, { reducedMotion }), [run, reducedMotion]);
  const [clock, setClock] = useState<{ plan: SimPlan; at: number } | null>(null);
  // A new plan (reduced motion switched on mid-run) starts its own clock at 0.
  const at = clock?.plan === plan ? clock.at : 0;
  useEffect(() => {
    const timers = plan.beats.map((beat) => window.setTimeout(() => setClock({ plan, at: beat }), beat));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [plan]);
  return useMemo(() => simView(run, plan, at), [run, plan, at]);
}
