"use client";

import { useMemo, useState } from "react";
import type { ArrivalDelta } from "@/app/features/library/jds/intake/IntakeArrivalMotion";

// The arrival delta for a LEDGER of stable ids — the source list, the scan history.
//
// `ArrivalList` (IntakeArrivalMotion.tsx) is the house cascade and this is the second
// way to feed it. The studio's own `useArrivalDelta` diffs a RoleBrief and treats its
// FIRST snapshot as history, because opening a finished session must not replay
// nineteen turns. A seeker's ledger wants the opposite opening: the rows ARE the
// surface, so they cascade once on first paint, and after that only a row that
// genuinely arrived (a source just added, a run that just landed) animates. An
// untouched row keeps its element and stays still — surface-doctrine §5, "only what
// changed animates".
//
// NO EFFECT, ON PURPOSE. The delta is derived state, and deriving it in an effect
// means a setState inside one — a cascading render the repo lints at error
// (`react-hooks/set-state-in-effect`). This is the render-phase adjustment React
// documents for exactly this shape, the same one `SchedulerJobRow` uses to mirror a
// stored cadence into its draft field: a guarded setState during render, which React
// re-runs before committing anything to the DOM.
//
// It also needs no expiry timer. `arriving` changes ONLY when the id list changes, so a
// re-render for any other reason (a rules panel opening, a refresh that changed
// nothing) hands `ArrivalList` the same set and replays nothing — framer applies
// `initial` at mount and never again.

type State = { key: string; seen: ReadonlySet<string>; arriving: readonly string[] };

export function useIdArrival(ids: readonly string[]): ArrivalDelta {
  // NUL-joined: an id cannot contain it, so two different lists cannot collide on one
  // key the way a comma-joined pair of ids could.
  const key = ids.join("\u0000");
  // The initializer is what makes the FIRST paint a cascade: the ids present at mount
  // are both already-seen (so they never arrive twice) and arriving (so they stagger).
  const [state, setState] = useState<State>(() => ({ key, seen: new Set(ids), arriving: [...ids] }));

  if (state.key !== key) {
    const fresh = ids.filter((id) => !state.seen.has(id));
    const seen = new Set(state.seen);
    for (const id of fresh) seen.add(id);
    setState({ key, seen, arriving: fresh });
  }

  return useMemo(() => {
    const order = new Map(state.arriving.map((id, i) => [id, i]));
    return {
      arriving: new Set(state.arriving),
      // A seeker row is REPLACED wholesale by its API response rather than re-graded in
      // place, so there is no "changed" class here to animate — claiming one would
      // replay `animate-arrive-in` on every toggle.
      changed: new Set<string>(),
      orderOf: (id: string) => order.get(id) ?? -1,
    };
  }, [state.arriving]);
}
