"use client";

import { useSimulation } from "@/app/features/shell/simulation/SimulationProvider";
import { useGettingStarted } from "./setupGettingStartedModel";
import { GettingStartedNextMove } from "./SetupGettingStartedNextMove";

// Getting-started checklist — the wizard's hand-off surface, living on the
// Pipeline board (the default tab). Every row is DATA-DERIVED server-side
// (GET /api/me/getting-started): doing the work through any door completes the
// step, so there is no per-step flag to drift. Rows deep-link to the REAL tab.
// Dismissal is a local, per-browser preference (the repo's convention for
// user-scoped UI state); the card also disappears for good once all four
// steps are complete.
//
// This file owns only the lifecycle (fetch, dismiss, all-done). The step taxonomy
// and derivations live in ./setupGettingStartedModel.ts and the rendered briefing
// in ./SetupGettingStartedNextMove.tsx, which is a pure view over the server
// payload — so no view can invent progress that the API didn't report.

export function GettingStartedCard() {
  const sim = useSimulation();
  const { data, dismissed, dismiss } = useGettingStarted();

  if (dismissed || !data || sim.running) return null;

  // All four steps done: the surface retires itself. An operator who has set up a
  // company, built a role, designed a case and wired an intake has done
  // everything this card teaches, so a congratulation card in the Pipeline
  // column would just be furniture standing where their work should be.
  if (data.allDone) return null;

  // "Next move": a briefing, not a to-do list — the first unfinished core step is
  // promoted to a full block with one primary action, the rest demoted to a rail.
  // That single-CTA shape is deliberate: the Pipeline empty state directly below
  // carries its own upstream links, and two competing CTA clusters read as noise.
  return <GettingStartedNextMove data={data} dismiss={dismiss} />;
}
