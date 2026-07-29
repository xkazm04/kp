"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronRight, Pause, Play, Sparkles } from "lucide-react";
import { buildUrl } from "@/app/features/shell/tabs";
import { useTasks } from "@/app/features/shell/tasks/TasksProvider";
import { useAttention } from "@/app/features/shell/useAttention";
import KandidateMark from "@/app/landing/_components/KandidateMark";
import { PassPreviewModal } from "@/app/features/hiring/pipeline/PassPreviewModal";
import { SIM_PHASES } from "./constants";
import { useSimulation } from "./SimulationProvider";
import { useAutomationPass, useControlMode, usePublishBarHeight } from "./simControlCenterKit";
import { SimControlDockSimFace } from "./SimControlDockSimFace";
import { SimControlDockOpsFace } from "./SimControlDockOpsFace";
import { ctrlBase, ctrlGhost } from "./simControlDockStyles";

/*
 * VARIANT A — "Flight Deck".
 * Metaphor: a mission-control console pinned to the bottom edge. One continuous
 * full-width strip that the whole workspace flies from. It has two faces sharing
 * the same chrome: the OPERATIONS deck (a command line + a row of automation
 * modules) and, the instant a demo starts, the GUIDED-SIMULATION console (a phase
 * stepper + run controls). The KandidateMark ("Candi") is the single power switch
 * that raises and lowers the deck — replacing the baseline's chevron — and pulses
 * whenever AI work is live, so it doubles as the entry into the app's AI actions.
 * Differs from baseline: the thin two-line SimBar becomes a deliberate, tokenized
 * console that also absorbs the pipeline page's action clutter.
 */

export function ControlDock() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sim = useSimulation();
  const mode = useControlMode();
  const { startTask, findActive } = useTasks();
  const pass = useAutomationPass();
  const attention = useAttention();
  const t = useTranslations("pipeline.controlCenter");

  // Start raised when the page loads straight into a demo (public ?sim=auto); the
  // effect below then handles the live ops → sim transition. Ops rest state is collapsed.
  const [collapsed, setCollapsed] = useState(mode !== "sim");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  usePublishBarHeight(panelRef, !collapsed);

  // Raise the deck automatically the moment a demo begins (ops → sim), so the tour
  // is visible without hunting for the switch. Fires on the transition only — the
  // viewer can still lower it mid-run.
  const prevMode = useRef(mode);
  useEffect(() => {
    if (mode === "sim" && prevMode.current !== "sim") setCollapsed(false);
    prevMode.current = mode;
  }, [mode]);

  const batch = findActive((t) => t.kind === "batch_screen");
  const aiBusy = sim.running || pass.busy || !!batch;
  const isPublicDemo = searchParams.get("sim") === "auto";
  const activeIdx = sim.phase ? SIM_PHASES.findIndex((p) => p.id === sim.phase) : -1;
  const last = sim.log[sim.log.length - 1]?.text;
  // The awaiting-a-human-decision count (the same number the sidebar Decisions
  // badge shows) — it turns the collapsed orb into a live beacon and gives the
  // ops deck a one-click route to what actually needs the recruiter.
  const awaiting = attention?.decisions ?? 0;
  const openDecisions = () => router.push(buildUrl({ tab: "decisions" }, searchParams.toString()));

  // The dry-run preview reuses the pipeline's rich look-before-commit modal
  // (reject-first, per-candidate), fed the board entries so each row names a
  // person. Rendered in both collapsed + expanded states so it survives a collapse.
  const passModal = pass.preview ? (
    <PassPreviewModal
      preview={pass.preview}
      entries={pass.entries}
      committing={pass.busy}
      onCommit={() => void pass.commit()}
      onClose={pass.dismiss}
    />
  ) : null;

  // ── Collapsed: the Candi orb (grafted from the Launcher direction) is the sole
  // initiator. A haloed round mark; in sim mode a caption bubble names the live
  // phase so the collapsed orb still narrates the running tour. ──
  if (collapsed) {
    const orbCaption = mode === "sim" ? (activeIdx >= 0 ? SIM_PHASES[activeIdx].label : sim.done ? t("hired") : t("starting")) : null;
    return (
      <>
        {passModal}
        {/* bottom-[max(...)] — clear of the iOS home-indicator strip, where taps
            feed the system swipe gesture instead of the button (safe-area vars
            are live because layout.tsx sets viewport-fit=cover). */}
        <div className="group fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-1/2 z-[var(--z-sim-bar)] -translate-x-1/2">
        {/* Sim: a caption bubble above narrates the live phase. */}
        {orbCaption ? (
          <span className="absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-stone-200 bg-white px-3 py-1 text-sm font-medium text-ink shadow-panel">
            {orbCaption}
          </span>
        ) : null}
        {/* Ops: a label slides in on hover so the orb isn't a mystery button. */}
        {mode === "ops" ? (
          <span className="pointer-events-none absolute right-full top-1/2 mr-3 -translate-y-1/2 whitespace-nowrap rounded-full border border-stone-200 bg-white px-3 py-1 text-sm font-medium text-ink opacity-0 shadow-panel transition-opacity group-hover:opacity-100">
            {awaiting > 0 ? t("titleAwaiting", { count: awaiting }) : t("title")}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label={awaiting > 0 ? t("openAwaiting", { count: awaiting }) : t("open")}
          aria-expanded={false}
          title={t("title")}
          className="focus-ring relative grid h-14 w-14 place-items-center rounded-full border-2 border-stone-300 bg-white shadow-pop ring-4 ring-coral/15 transition-all hover:ring-coral/30"
        >
          <KandidateMark className="h-9 w-9 text-ink [--k-fg:var(--color-paper)] [--k-accent:var(--color-coral)]" />
          {/* Beacon: how many candidates need a human decision right now. */}
          {awaiting > 0 ? (
            <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-coral px-1 text-meta font-bold text-white ring-2 ring-paper nums">
              {awaiting > 99 ? t("countOverflow") : awaiting}
            </span>
          ) : null}
          {/* AI at work — a distinct moss dot in the opposite corner from the beacon. */}
          {aiBusy ? <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-moss ring-2 ring-white motion-safe:animate-pulse" /> : null}
        </button>
        </div>
      </>
    );
  }

  // ── Sim-console controls (ported from the baseline, tokenized) ──
  const primary = !sim.running ? (
    sim.done ? (
      isPublicDemo ? (
        // Peak-intent climax on the public demo: convert into the app.
        <a href="/login" className={`${ctrlBase} bg-coral text-white shadow-sticker-xs hover:bg-coral/90`}>
          <Sparkles size={14} /> {t("getStarted")}
        </a>
      ) : (
        <button type="button" onClick={sim.start} className={`${ctrlBase} bg-ink text-white hover:opacity-90`}>
          <Play size={14} /> {t("runAgain")}
        </button>
      )
    ) : (
      <button type="button" onClick={sim.start} className={`${ctrlBase} bg-ink text-white shadow-sticker-xs hover:opacity-90`}>
        <Play size={14} /> {t("startSim")}
      </button>
    )
  ) : sim.awaitingNext ? (
    <button type="button" onClick={sim.next} className={`${ctrlBase} bg-coral text-white shadow-sticker-xs hover:bg-coral/90`}>
      {t("next")} <ChevronRight size={14} />
    </button>
  ) : sim.paused ? (
    <button type="button" onClick={sim.resume} className={`${ctrlBase} bg-moss text-white hover:opacity-90`}>
      <Play size={14} /> {t("resume")}
    </button>
  ) : (
    <button type="button" onClick={sim.pause} className={ctrlGhost}>
      <Pause size={14} /> {t("pause")}
    </button>
  );

  return (
    <>
      {passModal}
      <div
        ref={panelRef}
        className="fixed inset-x-0 bottom-0 z-[var(--z-sim-bar)] animate-fade-in border-t-2 border-stone-300 bg-white/95 shadow-panel backdrop-blur"
      >
      <div className="mx-auto max-w-[1600px] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {mode === "sim" ? (
          <SimControlDockSimFace
            sim={sim}
            router={router}
            searchParams={searchParams}
            activeIdx={activeIdx}
            last={last}
            primary={primary}
            aiBusy={aiBusy}
            onCollapse={() => setCollapsed(true)}
          />
        ) : (
          <SimControlDockOpsFace
            aiBusy={aiBusy}
            awaiting={awaiting}
            openDecisions={openDecisions}
            batch={batch}
            startTask={startTask}
            pass={pass}
            scheduleOpen={scheduleOpen}
            setScheduleOpen={setScheduleOpen}
            onStartTour={sim.start}
            onCollapse={() => setCollapsed(true)}
          />
        )}
      </div>
      </div>
    </>
  );
}
