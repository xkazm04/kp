"use client";

import { ControlDock } from "./SimControlDock";

// The bottom control center. Workspace mounts <SimBar/> (a DOM sibling of <main>,
// inside SimulationProvider + TasksProvider); the implementation is ControlDock —
// a two-LAYER dock raised from a Candi orb that beacons the awaiting-decision
// count. Layer 1 is a compact icon row (automations · command · schedule · Ask
// Candi); layer 2 is the ONE panel it opens above itself. The brand block and the
// single guided-demo button sit OUTSIDE the panel's borders in the same row.
export function SimBar() {
  return <ControlDock />;
}
