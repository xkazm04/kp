"use client";

import { useRouter } from "next/navigation";
import { BookOpen, Check, ChevronRight, Footprints, Pause, Play, RotateCcw, Square, Workflow } from "lucide-react";
import { buildUrl } from "@/app/features/tabs";
import { SIM_PHASES } from "./constants";
import { useSimulation } from "./SimulationProvider";

const SPEEDS = [
  { id: "slow", label: "Slow" },
  { id: "normal", label: "Normal" },
  { id: "fast", label: "Fast" },
] as const;

// Thin fixed bottom bar: (1) supporting nav — the pipeline chronology as a
// stepper showing where you are; (2) the paced simulation driver controls.
export function SimBar() {
  const router = useRouter();
  const sim = useSimulation();
  const last = sim.log[sim.log.length - 1]?.text;
  const activeIdx = sim.phase ? SIM_PHASES.findIndex((p) => p.id === sim.phase) : -1;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[47] border-t border-stone-200 bg-white/95 px-3 py-2 shadow-[0_-2px_14px_rgba(0,0,0,0.06)] backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex shrink-0 items-center gap-1.5 text-meta font-semibold uppercase tracking-wide text-coral">
          <Workflow size={14} /> Pipeline
        </span>

        <ol className="flex flex-1 flex-wrap items-center gap-0.5">
          {SIM_PHASES.map((p, i) => {
            const done = sim.done || activeIdx > i;
            const active = activeIdx === i && !sim.done;
            return (
              <li key={p.id} className="flex items-center">
                <button
                  type="button"
                  onClick={() => router.replace(buildUrl({ tab: p.tab }), { scroll: false })}
                  className={`focus-ring inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm font-medium transition-colors ${
                    active ? "bg-coral text-white" : done ? "bg-moss/15 text-moss" : "bg-stone-100 text-steel hover:bg-stone-200"
                  }`}
                  title={`Go to ${p.label}`}
                >
                  {done ? <Check size={11} /> : <span className="tabular-nums">{i + 1}</span>}
                  {p.label}
                </button>
                {i < SIM_PHASES.length - 1 ? <span className="px-0.5 text-stone-300">→</span> : null}
              </li>
            );
          })}
        </ol>

        <div className="flex shrink-0 items-center gap-1.5">
          {!sim.running ? (
            <button
              type="button"
              onClick={sim.start}
              className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:opacity-90"
            >
              <Play size={14} /> {sim.done ? "Run again" : "Start simulation"}
            </button>
          ) : sim.awaitingNext ? (
            <button
              type="button"
              onClick={sim.next}
              className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md bg-coral px-3 text-sm font-semibold text-white hover:opacity-90"
            >
              Next <ChevronRight size={14} />
            </button>
          ) : sim.paused ? (
            <button
              type="button"
              onClick={sim.resume}
              className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md bg-moss px-3 text-sm font-semibold text-white hover:opacity-90"
            >
              <Play size={14} /> Resume
            </button>
          ) : (
            <button
              type="button"
              onClick={sim.pause}
              className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 px-3 text-sm font-semibold text-steel hover:bg-stone-50"
            >
              <Pause size={14} /> Pause
            </button>
          )}
          {sim.running ? (
            <button
              type="button"
              onClick={sim.stop}
              className="focus-ring inline-flex h-8 items-center gap-1 rounded-md border border-stone-200 px-2.5 text-sm font-semibold text-coral hover:bg-coral/5"
            >
              <Square size={13} /> Stop
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void sim.reset()}
            title="Clear simulation data"
            className="focus-ring inline-flex h-8 items-center gap-1 rounded-md border border-stone-200 px-2.5 text-sm font-semibold text-steel hover:bg-stone-50"
          >
            <RotateCcw size={13} /> Reset
          </button>
        </div>
      </div>

      <div className="mx-auto mt-1 flex max-w-[1500px] flex-wrap items-center gap-x-3 gap-y-1">
        <p className="min-w-0 flex-1 truncate text-sm">
          <span className={sim.error ? "font-medium text-red-600" : "text-ink"}>{sim.status}</span>
          {last && last !== sim.status ? <span className="text-steel"> · {last}</span> : null}
        </p>

        {/* Speed */}
        <div className="flex shrink-0 items-center overflow-hidden rounded-md border border-stone-200 text-sm">
          {SPEEDS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => sim.setSpeed(s.id)}
              className={`px-2 py-0.5 font-medium ${sim.speed === s.id ? "bg-ink text-white" : "text-steel hover:bg-stone-50"}`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Step mode */}
        <button
          type="button"
          onClick={sim.toggleStep}
          className={`focus-ring inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-sm font-medium ${
            sim.stepMode ? "border-coral bg-coral/10 text-coral" : "border-stone-200 text-steel hover:bg-stone-50"
          }`}
          title="Pause at each step and advance with Next"
        >
          <Footprints size={13} /> Step
        </button>

        {/* Explainer */}
        <button
          type="button"
          onClick={sim.explainOpen ? sim.closeExplain : sim.openExplain}
          className={`focus-ring inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-sm font-medium ${
            sim.explainOpen ? "border-coral bg-coral/10 text-coral" : "border-stone-200 text-steel hover:bg-stone-50"
          }`}
          title="Show the diagram explaining this step"
        >
          <BookOpen size={13} /> Explain
        </button>
      </div>
    </div>
  );
}
