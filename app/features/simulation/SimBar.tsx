"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Check, ChevronDown, ChevronRight, ChevronUp, Footprints, Pause, Play, RotateCcw, Square, Workflow } from "lucide-react";
import { buildUrl } from "@/app/features/tabs";
import { SIM_PHASES } from "./constants";
import { useSimulation } from "./SimulationProvider";

// Minimizable footer. Collapsed by default: only a small pill sits at the bottom
// middle. Click it and the panel slides up (transition). A grab-tab minimizes it
// back — the run keeps playing behind the pill.
export function SimBar() {
  const router = useRouter();
  const sim = useSimulation();
  const [collapsed, setCollapsed] = useState(true);
  const last = sim.log[sim.log.length - 1]?.text;
  const activeIdx = sim.phase ? SIM_PHASES.findIndex((p) => p.id === sim.phase) : -1;

  const ctrlBtn = "focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-semibold";
  const ghost = "border border-stone-200 text-steel hover:bg-stone-50";

  const primary = !sim.running ? (
    <button type="button" onClick={sim.start} className={`${ctrlBtn} bg-ink text-white hover:opacity-90`}>
      <Play size={14} /> {sim.done ? "Run again" : "Start simulation"}
    </button>
  ) : sim.awaitingNext ? (
    <button type="button" onClick={sim.next} className={`${ctrlBtn} bg-coral text-white hover:opacity-90`}>
      Next <ChevronRight size={14} />
    </button>
  ) : sim.paused ? (
    <button type="button" onClick={sim.resume} className={`${ctrlBtn} bg-moss text-white hover:opacity-90`}>
      <Play size={14} /> Resume
    </button>
  ) : (
    <button type="button" onClick={sim.pause} className={`${ctrlBtn} ${ghost}`}>
      <Pause size={14} /> Pause
    </button>
  );

  return (
    <>
      {/* Collapsed handle — bottom middle */}
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        aria-label="Open the simulation panel"
        className={`fixed bottom-3 left-1/2 z-[47] flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-stone-200 bg-white/95 px-4 py-1.5 text-sm font-semibold text-ink shadow-lg backdrop-blur transition-all duration-300 ${
          collapsed ? "opacity-100" : "pointer-events-none translate-y-6 opacity-0"
        }`}
      >
        <Workflow size={14} className="text-coral" />
        Pipeline simulation
        {sim.running ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-coral" /> : null}
        <ChevronUp size={14} className="text-steel" />
      </button>

      {/* The panel */}
      <div
        className={`fixed inset-x-0 bottom-0 z-[47] border-t border-stone-200 bg-white/95 px-3 py-2 shadow-[0_-2px_14px_rgba(0,0,0,0.06)] backdrop-blur transition-transform duration-300 ${
          collapsed ? "translate-y-full" : "translate-y-0"
        }`}
      >
        {/* Grab-tab to minimize */}
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Minimize the simulation panel"
          title="Minimize"
          className="focus-ring absolute -top-[18px] left-1/2 inline-flex -translate-x-1/2 items-center rounded-t-md border border-b-0 border-stone-200 bg-white px-4 py-0.5 text-steel shadow-[0_-2px_6px_rgba(0,0,0,0.05)] hover:text-ink"
        >
          <ChevronDown size={16} />
        </button>

        {/* Row 1 — chronology stepper */}
        <div className="mx-auto flex max-w-[1500px] items-center gap-x-3 gap-y-1">
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
        </div>

        {/* Row 2 — status + demo controls */}
        <div className="mx-auto mt-1.5 flex max-w-[1500px] items-center gap-x-3">
          <p className="min-w-0 flex-1 truncate text-sm">
            <span className={sim.error ? "font-medium text-red-600" : "text-ink"}>{sim.status}</span>
            {last && last !== sim.status ? <span className="text-steel"> · {last}</span> : null}
          </p>

          <div className="flex shrink-0 items-center gap-1.5">
            {primary}
            {sim.running ? (
              <button type="button" onClick={sim.stop} className={`${ctrlBtn} border border-stone-200 px-2.5 text-coral hover:bg-coral/5`}>
                <Square size={13} /> Stop
              </button>
            ) : null}
            <button type="button" onClick={() => void sim.reset()} title="Clear simulation data" className={`${ctrlBtn} ${ghost} px-2.5`}>
              <RotateCcw size={13} /> Reset
            </button>
            <button
              type="button"
              onClick={sim.toggleStep}
              title="Pause at each step and advance with Next"
              className={`${ctrlBtn} border px-2.5 ${sim.stepMode ? "border-coral bg-coral/10 text-coral" : ghost}`}
            >
              <Footprints size={13} /> Step
            </button>
            <button
              type="button"
              onClick={sim.explainOpen ? sim.closeExplain : sim.openExplain}
              title="Show the diagram explaining this step"
              className={`${ctrlBtn} border px-2.5 ${sim.explainOpen ? "border-coral bg-coral/10 text-coral" : ghost}`}
            >
              <BookOpen size={13} /> Explain
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
