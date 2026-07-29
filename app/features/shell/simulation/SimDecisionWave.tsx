"use client";

import { Modal } from "@/app/_components/Modal";
import { FitTierBadge } from "@/app/_components/Badge";
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
      {decisions.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-stone-200 bg-stone-50/60 px-4 py-6 text-center text-sm text-steel">
          No matched candidates in this wave.
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-stone-100 rounded-lg border border-stone-200">
          {decisions.map((d) => {
            // null = unscored (excluded from auto-decisions server-side): the row
            // shows a dash and an empty meter, never a fabricated 0-that-looks-real.
            const pct = d.matchScore == null ? 0 : Math.max(0, Math.min(100, d.matchScore));
            return (
              <li key={d.entryId} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-micro font-semibold uppercase ${
                    d.action === "reject" ? "bg-red-50 text-red-700" : "bg-moss/15 text-moss"
                  }`}
                >
                  {d.action === "reject" ? "Rejected" : "Kept"}
                </span>
                <span className="w-32 shrink-0 truncate text-ink">{d.label}</span>
                <div className="flex w-28 shrink-0 items-center gap-2">
                  <span className="w-7 shrink-0 text-right nums font-medium text-ink">{d.matchScore ?? "—"}</span>
                  <span
                    className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-stone-100"
                    role="meter"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={d.matchScore == null ? "Match score not yet measured" : `Match score ${d.matchScore}`}
                  >
                    <span
                      className={`block h-full rounded-full ${d.action === "reject" ? "bg-coral" : "bg-moss"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                </div>
                <FitTierBadge score={d.matchScore} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-steel">{d.rationale}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
