"use client";

import { useEffect } from "react";
import type { SimRuntime, SimRuntimeProps } from "./simulationProviderTypes";
import { useSimulationEngine } from "./useSimulationEngine";
import { useSimulationWalk } from "./useSimulationWalk";

// The guided demo's ENGINE + SCRIPTED WALK, mounted only once something needs them.
//
// They are the heaviest code the workspace shell carried (the whole design → hired
// script, the real-click engine, and the formatters, stage helpers and wave reader they
// pull in), and an operator who never presses Start needs none of it. So
// SimulationProvider keeps the run CONTROL (state, pause/step/stop, reset, the resume
// door) and loads this component through next/dynamic the first time the walk is
// wanted: Start or Resume, a `?sim=auto` arrival, or a board with sim residue to read
// for the resume offer. It renders nothing; it publishes its three entry points back to
// the provider through `onReady`, and stays mounted for the rest of the document, so the
// run lease the walk holds lives exactly as long as it did before the split.
//
// The hooks are unchanged and receive the same provider callbacks they always did.
export function SimulationRuntime({ ctrl, patch, log, nav, beat, gate, onReady }: SimRuntimeProps) {
  const engine = useSimulationEngine({ ctrl, patch, log, beat });
  const { run, releaseLease } = useSimulationWalk({ ctrl, patch, log, nav, beat, gate, engine });
  const { getBoard } = engine;
  useEffect(() => {
    const runtime: SimRuntime = { run, releaseLease, getBoard };
    onReady(runtime);
  }, [onReady, run, releaseLease, getBoard]);
  return null;
}
