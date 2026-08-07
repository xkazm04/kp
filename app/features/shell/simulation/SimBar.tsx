"use client";

import { ControlDock } from "./SimControlDock";

// The bottom control center. Workspace mounts <SimBar/> (a DOM sibling of <main>,
// inside SimulationProvider + TasksProvider); the implementation is ControlDock —
// a two-faced dock that is the guided-simulation console in demo mode and the
// operations deck (command line + AI screen / automation pass / schedule / tour)
// otherwise, raised from a Candi orb that beacons the awaiting-decision count.
export function SimBar() {
  return <ControlDock />;
}
