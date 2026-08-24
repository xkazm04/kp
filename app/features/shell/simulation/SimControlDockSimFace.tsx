"use client";

// LAYER-2 PANEL "sim" — the guided-simulation console. Was one of the dock's two
// faces; the two-layer redesign turned it into a panel body, so the Candi switch
// and the "Guided demo" eyebrow moved UP into the layer-1 toolbar. Everything the
// console itself owns is unchanged: the phase stepper, the status line, and the
// run controls (primary action, stop/reset/step/explain) — including the primary
// action, which used to be built in SimControlDock.tsx and now lives beside the
// only face that renders it.
import { BookOpen, Check, ChevronRight, Footprints, Pause, Play, RotateCcw, Sparkles, Square } from "lucide-react";
import type { ReadonlyURLSearchParams } from "next/navigation";
import type { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { buildUrl } from "@/app/features/shell/tabs";
import { SIM_PHASES } from "./constants";
import { phaseStepState, type PhaseStepState } from "./simPhaseStep";
import { PHASE_ICON } from "./simControlCenterKit";
import type { useSimulation } from "./SimulationProvider";
import { ctrlBase, ctrlGhost, ctrlToggle } from "./simControlDockStyles";

// bug-ui-scan-2026-07-09 (guided-pipeline-simulation #4): the i18n key that spells
// out each step's state for its accessible name (kept beside the states so they
// can't drift). The icon/color stay decorative; this is the non-color cue.
const PHASE_STATE_KEY: Record<PhaseStepState, "phaseCompleted" | "phaseCurrent" | "phaseUpcoming"> = {
  completed: "phaseCompleted",
  current: "phaseCurrent",
  upcoming: "phaseUpcoming",
};

// The one control whose label depends on where the run is: start / run again /
// next / resume / pause — and, on the public `?sim=auto` demo that has finished,
// the peak-intent conversion into the app instead of a replay.
function PrimaryAction({ sim, isPublicDemo }: { sim: ReturnType<typeof useSimulation>; isPublicDemo: boolean }) {
  const t = useTranslations("pipeline.controlCenter");
  if (sim.running) {
    if (sim.awaitingNext) {
      return (
        <button type="button" onClick={sim.next} className={`${ctrlBase} bg-coral text-white shadow-sticker-xs hover:bg-coral/90`}>
          {t("next")} <ChevronRight size={14} />
        </button>
      );
    }
    if (sim.paused) {
      return (
        <button type="button" onClick={sim.resume} className={`${ctrlBase} bg-moss text-white hover:opacity-90`}>
          <Play size={14} /> {t("resume")}
        </button>
      );
    }
    return (
      <button type="button" onClick={sim.pause} className={ctrlGhost}>
        <Pause size={14} /> {t("pause")}
      </button>
    );
  }
  if (!sim.done) {
    return (
      <button type="button" onClick={sim.start} className={`${ctrlBase} bg-ink text-white shadow-sticker-xs hover:opacity-90`}>
        <Play size={14} /> {t("startSim")}
      </button>
    );
  }
  return isPublicDemo ? (
    <a href="/login" className={`${ctrlBase} bg-coral text-white shadow-sticker-xs hover:bg-coral/90`}>
      <Sparkles size={14} /> {t("getStarted")}
    </a>
  ) : (
    <button type="button" onClick={sim.start} className={`${ctrlBase} bg-ink text-white hover:opacity-90`}>
      <Play size={14} /> {t("runAgain")}
    </button>
  );
}

export function SimControlDockSimFace({
  sim,
  router,
  searchParams,
  activeIdx,
  last,
  isPublicDemo,
}: {
  sim: ReturnType<typeof useSimulation>;
  router: ReturnType<typeof useRouter>;
  searchParams: ReadonlyURLSearchParams;
  activeIdx: number;
  last: string | undefined;
  isPublicDemo: boolean;
}) {
  const t = useTranslations("pipeline.controlCenter");
  const tSim = useTranslations("simulation");
  return (
    <div className="space-y-2.5">
      {/* bug-ui-scan-2026-07-09 (guided-pipeline-simulation #4): name the list
          and embed done/current/upcoming into each step's accessible name, so
          the chronology isn't conveyed by color + an aria-hidden icon alone. */}
      <ol aria-label={t("phasesLabel")} className="flex flex-wrap items-center gap-1">
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-40 flex-1 truncate text-sm">
          {/* The idle status is the ONE state the provider can't mint itself (it is
              the module-level IDLE_STATE, outside any translator), so the empty
              string it carries resolves to localized copy here. */}
          <span className={sim.error ? "font-medium text-red-600" : "text-ink"}>{sim.status || tSim("status.idle")}</span>
          {last && last !== sim.status ? <span className="text-steel"> · {last}</span> : null}
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <PrimaryAction sim={sim} isPublicDemo={isPublicDemo} />
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
