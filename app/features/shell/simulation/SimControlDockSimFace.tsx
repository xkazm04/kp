"use client";

// FACE 1 — the guided-simulation console, split out of SimControlDock.tsx so it
// stays under the 200-line file cap. Verbatim markup: the phase stepper + the
// run controls (primary action, stop/reset/step/explain).
import type { ReactNode } from "react";
import { BookOpen, Check, ChevronRight, Footprints, RotateCcw, Sparkles, Square } from "lucide-react";
import type { ReadonlyURLSearchParams } from "next/navigation";
import type { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { buildUrl } from "@/app/features/shell/tabs";
import { SIM_PHASES } from "./constants";
import { phaseStepState, type PhaseStepState } from "./simPhaseStep";
import { PHASE_ICON } from "./simControlCenterKit";
import type { useSimulation } from "./SimulationProvider";
import { CandiSwitch } from "./SimControlDockTiles";
import { ctrlBase, ctrlToggle } from "./simControlDockStyles";

// bug-ui-scan-2026-07-09 (guided-pipeline-simulation #4): the i18n key that spells
// out each step's state for its accessible name (kept beside the states so they
// can't drift). The icon/color stay decorative; this is the non-color cue.
const PHASE_STATE_KEY: Record<PhaseStepState, "phaseCompleted" | "phaseCurrent" | "phaseUpcoming"> = {
  completed: "phaseCompleted",
  current: "phaseCurrent",
  upcoming: "phaseUpcoming",
};

export function SimControlDockSimFace({
  sim,
  router,
  searchParams,
  activeIdx,
  last,
  primary,
  aiBusy,
  onCollapse,
}: {
  sim: ReturnType<typeof useSimulation>;
  router: ReturnType<typeof useRouter>;
  searchParams: ReadonlyURLSearchParams;
  activeIdx: number;
  last: string | undefined;
  primary: ReactNode;
  aiBusy: boolean;
  onCollapse: () => void;
}) {
  const t = useTranslations("pipeline.controlCenter");
  const tSim = useTranslations("simulation");
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-3">
        <CandiSwitch open onClick={onCollapse} busy={aiBusy} />
        <span className="hidden shrink-0 items-center gap-1.5 text-meta font-semibold uppercase tracking-wide text-coral sm:flex">
          <Sparkles size={13} /> {t("guidedDemo")}
        </span>
        {/* bug-ui-scan-2026-07-09 (guided-pipeline-simulation #4): name the list
            and embed done/current/upcoming into each step's accessible name, so
            the chronology isn't conveyed by color + an aria-hidden icon alone. */}
        <ol aria-label={t("phasesLabel")} className="flex flex-1 flex-wrap items-center gap-1">
          {SIM_PHASES.map((p, i) => {
            const Icon = PHASE_ICON[p.id];
            const label = tSim(`phase.${p.id}`);
            const state = phaseStepState({ activeIdx, index: i, simDone: sim.done });
            const done = state === "completed";
            const active = state === "current";
            return (
              <li key={p.id} className="flex items-center">
                <button
                  type="button"
                  onClick={() => router.replace(buildUrl({ tab: p.tab }, searchParams.toString()), { scroll: false })}
                  aria-current={active ? "step" : undefined}
                  aria-label={t("phaseStep", { label, state: t(PHASE_STATE_KEY[state]) })}
                  title={t("goToPhase", { label })}
                  className={`focus-ring inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm transition-colors ${
                    active
                      ? "bg-coral font-semibold text-white shadow-sticker-xs"
                      : done
                        ? "bg-moss/15 font-medium text-moss"
                        : "bg-stone-100 font-medium text-steel hover:bg-stone-200"
                  }`}
                >
                  {done ? <Check size={13} aria-hidden /> : <Icon size={13} aria-hidden />}
                  {label}
                </button>
                {i < SIM_PHASES.length - 1 ? (
                  <ChevronRight size={13} aria-hidden className={`mx-0.5 ${done ? "text-moss" : "text-stone-300"}`} />
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pl-14">
        <p className="min-w-40 flex-1 truncate text-sm">
          {/* The idle status is the ONE state the provider can't mint itself (it is
              the module-level IDLE_STATE, outside any translator), so the empty
              string it carries resolves to localized copy here. */}
          <span className={sim.error ? "font-medium text-red-600" : "text-ink"}>{sim.status || tSim("status.idle")}</span>
          {last && last !== sim.status ? <span className="text-steel"> · {last}</span> : null}
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {primary}
          {sim.running ? (
            <button type="button" onClick={sim.stop} className={`${ctrlBase} border border-stone-200 px-2.5 text-coral hover:bg-coral/5`}>
              <Square size={13} /> {t("stop")}
            </button>
          ) : null}
          <button type="button" onClick={() => void sim.reset()} title={t("resetTitle")} className={ctrlToggle(false)}>
            <RotateCcw size={13} /> {t("reset")}
          </button>
          <button type="button" onClick={sim.toggleStep} title={t("stepTitle")} className={ctrlToggle(sim.stepMode)}>
            <Footprints size={13} /> {t("step")}
          </button>
          <button
            type="button"
            onClick={sim.explainOpen ? sim.closeExplain : sim.openExplain}
            title={t("explainTitle")}
            className={ctrlToggle(sim.explainOpen)}
          >
            <BookOpen size={13} /> {t("explain")}
          </button>
        </div>
      </div>
    </div>
  );
}
