"use client";

import { Modal } from "@/app/_components/Modal";
import { useSimulation } from "./SimulationProvider";

// Shows the screening "first wave" of automated decisions during the simulation:
// each matched candidate's score + keep/reject + the rationale, with early-career
// visibly never auto-rejected.
export function SimDecisionWave() {
  const { screenWave, closeScreenWave } = useSimulation();
  if (!screenWave) return null;
  const { decisions, rejected, kept, cohort } = screenWave;
  return (
    <Modal
      title="Screening · first automated decision wave"
      subtitle={`${cohort} matched · ${rejected} auto-rejected · ${kept} advanced`}
      size="lg"
      onClose={closeScreenWave}
    >
      <p className="text-sm text-steel">
        Initial scoring + the automated screening decision. Early-career candidates are never auto-rejected — the fairness
        gate holds, and every auto-decision carries a rationale.
      </p>
      <ul className="mt-3 divide-y divide-stone-100 rounded-lg border border-stone-200">
        {decisions.map((d) => (
          <li key={d.entryId} className="flex items-center gap-2 px-3 py-1.5 text-sm">
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-micro font-semibold uppercase ${
                d.action === "reject" ? "bg-red-50 text-red-700" : "bg-moss/15 text-moss"
              }`}
            >
              {d.action === "reject" ? "Rejected" : "Kept"}
            </span>
            <span className="w-32 shrink-0 truncate text-ink">{d.label}</span>
            <span className="w-8 shrink-0 tabular-nums text-steel">{d.matchScore}</span>
            <span className="min-w-0 flex-1 truncate text-steel">{d.rationale}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
