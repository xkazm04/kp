"use client";

// Simulation overlays + first-run onboarding, split out of Workspace.tsx to stay
// under the 200-line file cap. The simulation surfaces are code-split: the five
// overlays mount only while a demo is engaged, so their chunks — and the heavy
// modals/diagrams they pull in (GroupEvalModal, PlantUml diagrams, the
// screening-wave Modal) — never load in an idle workspace. SimBar always mounts
// (it's the persistent control center), so its chunk still loads on every
// workspace, but as a separate async chunk that no longer weighs down the initial
// shell bundle. No `ssr:false`: these are client components that render null when
// idle, so they SSR to nothing and hydrate without a mismatch.
import dynamic from "next/dynamic";
import { useSimulation } from "./simulation/SimulationProvider";

const SimSpotlight = dynamic(() => import("./simulation/SimSpotlight").then((m) => ({ default: m.SimSpotlight })));
const SimExplainDrawer = dynamic(() => import("./simulation/SimExplainDrawer").then((m) => ({ default: m.SimExplainDrawer })));
const SimOfferFrame = dynamic(() => import("./simulation/SimOfferFrame").then((m) => ({ default: m.SimOfferFrame })));
const SimGroupEval = dynamic(() => import("./simulation/SimGroupEval").then((m) => ({ default: m.SimGroupEval })));
const SimDecisionWave = dynamic(() => import("./simulation/SimDecisionWave").then((m) => ({ default: m.SimDecisionWave })));
const SimBar = dynamic(() => import("./simulation/SimBar").then((m) => ({ default: m.SimBar })));
// First-run onboarding wizard: code-split like the sim overlays — its chunk loads
// only for the rare session whose server gate (onboarding-gate.ts) said "never
// onboarded", so every other workspace load pays nothing for it.
export const FirstRunOnboarding = dynamic(() => import("./setup/OnboardingExperience").then((m) => ({ default: m.OnboardingExperience })));

// Gate for the code-split simulation surfaces. The five overlays each render null
// unless their slice of sim state is set; mounting them only while the sim is
// engaged keeps their chunks out of an idle workspace. `running` covers the
// spotlight's lead time — it flips true synchronously in start() (before run()
// patches the first spotlight), so the dynamic import resolves well before the
// first coachmark needs to paint. SimBar/ControlDock is the always-present control
// center + a start affordance (guided-tour tile, command bar) — never gated.
export function SimSurfaces() {
  const { running, explainOpen, spotlight, frame, groupEval, screenWave } = useSimulation();
  const active = running || explainOpen || Boolean(spotlight || frame || groupEval || screenWave);
  return (
    <>
      {active ? (
        <>
          <SimSpotlight />
          <SimExplainDrawer />
          <SimOfferFrame />
          <SimGroupEval />
          <SimDecisionWave />
        </>
      ) : null}
      <SimBar />
    </>
  );
}
