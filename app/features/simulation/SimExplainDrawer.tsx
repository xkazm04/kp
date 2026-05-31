"use client";

import { X } from "lucide-react";
import { PlantUml } from "@/app/_components/puml/PlantUml";
import { SIM_PHASES } from "./constants";
import { PHASE_DIAGRAM } from "./diagrams";
import { useSimulation } from "./SimulationProvider";

// Right-side explainer drawer (mirrors CandidateDrawer's pattern). Shows the
// diagram for the phase the simulation is currently on, so the customer sees the
// mechanism behind what's happening on screen. Non-modal: it doesn't trap focus
// or block the page, so the walkthrough keeps playing alongside it.
export function SimExplainDrawer() {
  const { explainOpen, phase, closeExplain } = useSimulation();
  if (!explainOpen) return null;

  const current = phase ?? "design";
  const meta = SIM_PHASES.find((p) => p.id === current);
  const source = PHASE_DIAGRAM[current];

  return (
    <aside
      role="dialog"
      aria-label="Simulation explainer"
      className="animate-slide-in fixed bottom-[68px] right-3 top-3 z-[46] flex w-[min(92vw,28rem)] flex-col overflow-hidden rounded-xl border border-stone-200 bg-paper shadow-2xl"
    >
      <header className="flex items-center justify-between border-b border-stone-200 bg-paper/95 px-4 py-3 backdrop-blur">
        <div>
          <p className="text-meta uppercase tracking-wide text-coral">How it works</p>
          <h3 className="font-serif text-h3 text-ink">{meta?.label ?? "Pipeline"}</h3>
        </div>
        <button
          type="button"
          onClick={closeExplain}
          aria-label="Close explainer"
          className="focus-ring rounded-md p-1.5 text-steel hover:bg-stone-100"
        >
          <X size={18} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <PlantUml source={source} className="w-full" />
        <p className="mt-3 text-sm leading-relaxed text-steel">
          <span className="inline-block h-2.5 w-2.5 translate-y-0.5 rounded-sm bg-moss/70" /> automated ·{" "}
          <span className="inline-block h-2.5 w-2.5 translate-y-0.5 rounded-sm bg-coral/70" /> human decision. The
          walkthrough keeps playing — this panel updates as the pipeline advances.
        </p>
      </div>
    </aside>
  );
}
