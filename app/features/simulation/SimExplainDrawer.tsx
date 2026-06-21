"use client";

import { X } from "lucide-react";
import { PlantUml } from "@/app/_components/puml/PlantUml";
import { SIM_PHASES, type SimPhaseId } from "./constants";
import { CRITERION_WEIGHT_STYLE, criteriaThroughPhase } from "./criteria";
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
    // A complementary info panel, NOT a modal: it deliberately doesn't trap focus or
    // block the page (the walkthrough plays alongside it). role="dialog" wrongly promised
    // modal focus management; the labeled <aside> (complementary landmark) is the honest role.
    <aside
      aria-label="Simulation explainer"
      className="animate-slide-in motion-reduce:animate-none fixed bottom-[calc(var(--sim-bar-h)_+_8px)] right-3 top-3 z-[var(--z-sim-drawer)] flex w-[min(92vw,28rem)] flex-col overflow-hidden rounded-xl border border-stone-200 bg-paper shadow-2xl"
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
        <PlantUml source={source} className="w-full" expandable />
        <CriteriaTable phase={current} />
      </div>
    </aside>
  );
}

// The decision-criteria reference: a thin 3-column table whose structure stays
// fixed across every phase, but whose ROWS accrue as the walkthrough advances —
// each criterion appears the moment the pipeline reaches the step that gathers
// it (see ./criteria), so the customer watches the decision basis build up. The
// rows are sourced from the real pipeline, not hand-written here.
function CriteriaTable({ phase }: { phase: SimPhaseId }) {
  const rows = criteriaThroughPhase(phase);

  return (
    <section className="mt-4 border-t border-stone-200 pt-3">
      <p className="text-meta uppercase tracking-wide text-steel">Decision criteria</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm leading-relaxed text-steel/80">
          Criteria appear here as the pipeline evaluates each candidate.
        </p>
      ) : (
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-steel/70">
              <th className="pb-1.5 font-medium">Criterion</th>
              <th className="pb-1.5 font-medium">Weight</th>
              <th className="pb-1.5 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const w = CRITERION_WEIGHT_STYLE[c.weight];
              // Fade rows in only on the step that first gathers them; earlier
              // rows are already mounted and stay put.
              const fresh = c.phase === phase ? "animate-fade-in motion-reduce:animate-none" : "";
              return (
                <tr key={c.criterion} className={`border-t border-stone-200/70 ${fresh}`}>
                  <td className="py-1.5 pr-3 text-ink">{c.criterion}</td>
                  <td className="py-1.5 pr-3">
                    <span className="inline-flex items-center gap-1.5 text-steel">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${w.dot}`} />
                      {w.label}
                    </span>
                  </td>
                  <td className="py-1.5 whitespace-nowrap text-steel">{c.source}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
