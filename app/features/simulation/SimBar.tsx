"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpen, Check, ChevronDown, ChevronRight, ChevronUp, Footprints, Pause, Play, RotateCcw, Sparkles, Square, Workflow } from "lucide-react";
import { buildUrl } from "@/app/features/tabs";
import { SIM_PHASES } from "./constants";
import { useSimulation } from "./SimulationProvider";

// Minimizable footer. Collapsed by default: only a small pill sits at the bottom
// middle. Click it and the panel slides up (transition). A grab-tab minimizes it
// back — the run keeps playing behind the pill.
export function SimBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sim = useSimulation();
  const [collapsed, setCollapsed] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);

  // Publish the bar's real height to :root as --sim-bar-h so the explainer
  // drawer and offer frame (DOM siblings, not descendants — they can't inherit
  // it from this element) anchor just above the bar via
  // bottom-[calc(var(--sim-bar-h)+8px)] instead of a hardcoded offset. The
  // ResizeObserver re-measures whenever the bar is restyled, and offsetHeight
  // ignores the collapse transform so the value stays stable either way.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--sim-bar-h", `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--sim-bar-h");
    };
  }, []);

  const last = sim.log[sim.log.length - 1]?.text;
  const activeIdx = sim.phase ? SIM_PHASES.findIndex((p) => p.id === sim.phase) : -1;

  const ctrlBtn = "focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-semibold";
  const ghost = "border border-stone-200 text-steel hover:bg-stone-50";

  const primary = !sim.running ? (
    sim.done ? (
      // Climax — the prospect just watched a candidate walk JD→Hired. This is the
      // peak-intent moment, so the terminal state leads with a real conversion CTA
      // into the app (the demo used to dead-end on "Run again", leaking that intent).
      <div className="flex flex-wrap items-center gap-2">
        <a href="/login" className={`${ctrlBtn} bg-coral text-white hover:opacity-90`}>
          <Sparkles size={14} /> Get started — do it with your roles
        </a>
        <button type="button" onClick={sim.start} className={`${ctrlBtn} ${ghost}`}>
          <Play size={14} /> Run again
        </button>
      </div>
    ) : (
      <button type="button" onClick={sim.start} className={`${ctrlBtn} bg-ink text-white hover:opacity-90`}>
        <Play size={14} /> Start simulation
      </button>
    )
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
        className={`fixed bottom-3 left-1/2 z-[var(--z-sim-bar)] flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-stone-200 bg-white/95 px-4 py-1.5 text-sm font-semibold text-ink shadow-lg backdrop-blur transition-all duration-300 motion-reduce:transition-none ${
          collapsed ? "opacity-100" : "pointer-events-none translate-y-6 opacity-0"
        }`}
      >
        <Workflow size={14} className="text-coral" />
        Pipeline simulation
        {sim.running ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-coral motion-reduce:animate-none" /> : null}
        <ChevronUp size={14} className="text-steel" />
      </button>

      {/* The panel */}
      <div
        ref={panelRef}
        className={`fixed inset-x-0 bottom-0 z-[var(--z-sim-bar)] border-t border-stone-200 bg-white/95 px-3 py-2 shadow-[0_-2px_14px_rgba(0,0,0,0.06)] backdrop-blur transition-transform duration-300 motion-reduce:transition-none ${
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
                    onClick={() => router.replace(buildUrl({ tab: p.tab }, searchParams.toString()), { scroll: false })}
                    aria-current={active ? "step" : undefined}
                    className={`focus-ring inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm transition-all motion-reduce:transition-none ${
                      active
                        ? "scale-105 bg-coral font-semibold text-white"
                        : done
                          ? "bg-moss/15 font-medium text-moss"
                          : "bg-stone-100 font-medium text-steel hover:bg-stone-200"
                    }`}
                    title={`Go to ${p.label}`}
                  >
                    {done ? <Check size={11} /> : <span className="nums">{i + 1}</span>}
                    {p.label}
                  </button>
                  {i < SIM_PHASES.length - 1 ? (
                    <span aria-hidden="true" className={`px-0.5 transition-colors motion-reduce:transition-none ${done ? "text-moss" : "text-stone-300"}`}>→</span>
                  ) : null}
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
