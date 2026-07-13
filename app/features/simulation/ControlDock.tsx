"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BookOpen,
  Check,
  ChevronRight,
  Clock,
  Footprints,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  Wand2,
  X,
  type LucideIcon,
} from "lucide-react";
import { buildUrl } from "@/app/features/tabs";
import { useTasks } from "@/app/features/tasks/TasksProvider";
import { useAttention } from "@/app/features/useAttention";
import { notifyDataChanged } from "@/app/features/live-refresh";
import KandidateMark from "@/app/landing/_components/KandidateMark";
import { CommandBar } from "@/app/features/sub_pipeline/CommandBar";
import { SchedulerControl } from "@/app/features/sub_pipeline/SchedulerControl";
import { PassPreviewModal } from "@/app/features/sub_pipeline/PassPreviewModal";
import { SIM_PHASES } from "./constants";
import { phaseStepState, type PhaseStepState } from "./phaseStep";
import { useSimulation } from "./SimulationProvider";
import { PHASE_ICON, useAutomationPass, useControlMode, usePublishBarHeight, type PassSummary } from "./controlCenterKit";

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

// The Candi power switch. Same element raises the deck (collapsed) and lowers it
// (expanded) — the one show/hide control the whole variant hangs off.
function CandiSwitch({ open, onClick, busy }: { open: boolean; onClick: () => void; busy: boolean }) {
  const t = useTranslations("pipeline.controlCenter");
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={open ? t("close") : t("open")}
      aria-expanded={open}
      className="focus-ring group relative grid h-11 w-11 shrink-0 place-items-center rounded-xl border-2 border-stone-300 bg-white shadow-sticker-sm transition-colors hover:border-coral/50"
    >
      <KandidateMark className="h-7 w-7 text-ink [--k-fg:var(--color-paper)] [--k-accent:var(--color-coral)]" />
      {busy ? (
        <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-coral ring-2 ring-white motion-safe:animate-pulse" />
      ) : null}
    </button>
  );
}

// One automation module in the ops deck — icon sticker + label (+ optional live
// sublabel), coral-lit when active. Real recruitment affordance, not a marker.
function DeckTile({
  icon: Icon,
  label,
  sublabel,
  onClick,
  active = false,
  disabled = false,
}: {
  icon: LucideIcon;
  label: string;
  sublabel?: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`focus-ring group inline-flex h-11 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors disabled:opacity-50 ${
        active ? "border-coral bg-coral/10 text-coral" : "border-stone-200 bg-white text-ink hover:border-coral/40"
      }`}
    >
      <span
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-md border transition-colors ${
          active ? "border-coral/40 bg-white text-coral" : "border-stone-200 bg-paper text-steel group-hover:text-coral"
        }`}
      >
        <Icon size={15} aria-hidden />
      </span>
      <span className="flex flex-col items-start leading-tight">
        <span>{label}</span>
        {sublabel ? <span className="text-meta font-medium text-steel">{sublabel}</span> : null}
      </span>
    </button>
  );
}

// The dry-run / committed / error tape that unrolls under the deck when the
// automation pass runs — the AUTO3 look-before-commit gate, tokenized.
function PassStrip({ pass }: { pass: ReturnType<typeof useAutomationPass> }) {
  const t = useTranslations("pipeline.controlCenter");
  const line = (s: PassSummary) => t("passLine", { advanced: s.advanced, rejected: s.rejected, held: s.held, alerts: s.alerts });
  if (pass.error) {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        <span>{pass.error}</span>
        <button type="button" onClick={pass.dismiss} aria-label={t("dismiss")} className="focus-ring rounded p-0.5 hover:opacity-70">
          <X size={14} aria-hidden />
        </button>
      </div>
    );
  }
  if (pass.committed) {
    return (
      <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-moss/30 bg-moss/5 px-3 py-2 text-sm text-ink">
        <span className="inline-flex items-center gap-1.5 font-semibold text-moss">
          <Check size={14} aria-hidden /> {t("passApplied")}
        </span>
        <span className="text-steel nums">{line(pass.committed)}</span>
        <button type="button" onClick={pass.dismiss} className="focus-ring ml-auto text-meta font-semibold text-steel hover:text-ink">
          {t("dismiss")}
        </button>
      </div>
    );
  }
  // The pending dry run is shown in the full PassPreviewModal (per-decision,
  // reject-first), not here — this strip only carries the after-states.
  return null;
}

// bug-ui-scan-2026-07-09 (guided-pipeline-simulation #4): the i18n key that spells
// out each step's state for its accessible name (kept beside the states so they
// can't drift). The icon/color stay decorative; this is the non-color cue.
const PHASE_STATE_KEY: Record<PhaseStepState, "phaseCompleted" | "phaseCurrent" | "phaseUpcoming"> = {
  completed: "phaseCompleted",
  current: "phaseCurrent",
  upcoming: "phaseUpcoming",
};

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
        <div className="group fixed bottom-5 left-1/2 z-[var(--z-sim-bar)] -translate-x-1/2">
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
  const ctrlBase = "focus-ring inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-all";
  const ctrlGhost = `${ctrlBase} border border-stone-200 text-steel hover:border-coral/40 hover:text-ink`;
  const ctrlToggle = (on: boolean) => `${ctrlBase} border px-2.5 ${on ? "border-coral bg-coral/10 text-coral" : "border-stone-200 text-steel hover:border-coral/40 hover:text-ink"}`;

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
      <div className="mx-auto max-w-[1600px] px-4 py-3">
        {mode === "sim" ? (
          // ── FACE 1 — guided-simulation console ──
          <div className="space-y-2.5">
            <div className="flex items-center gap-3">
              <CandiSwitch open onClick={() => setCollapsed(true)} busy={aiBusy} />
              <span className="hidden shrink-0 items-center gap-1.5 text-meta font-semibold uppercase tracking-wide text-coral sm:flex">
                <Sparkles size={13} /> {t("guidedDemo")}
              </span>
              {/* bug-ui-scan-2026-07-09 (guided-pipeline-simulation #4): name the list
                  and embed done/current/upcoming into each step's accessible name, so
                  the chronology isn't conveyed by color + an aria-hidden icon alone. */}
              <ol aria-label={t("phasesLabel")} className="flex flex-1 flex-wrap items-center gap-1">
                {SIM_PHASES.map((p, i) => {
                  const Icon = PHASE_ICON[p.id];
                  const state = phaseStepState({ activeIdx, index: i, simDone: sim.done });
                  const done = state === "completed";
                  const active = state === "current";
                  return (
                    <li key={p.id} className="flex items-center">
                      <button
                        type="button"
                        onClick={() => router.replace(buildUrl({ tab: p.tab }, searchParams.toString()), { scroll: false })}
                        aria-current={active ? "step" : undefined}
                        aria-label={t("phaseStep", { label: p.label, state: t(PHASE_STATE_KEY[state]) })}
                        title={t("goToPhase", { label: p.label })}
                        className={`focus-ring inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm transition-colors ${
                          active
                            ? "bg-coral font-semibold text-white shadow-sticker-xs"
                            : done
                              ? "bg-moss/15 font-medium text-moss"
                              : "bg-stone-100 font-medium text-steel hover:bg-stone-200"
                        }`}
                      >
                        {done ? <Check size={13} aria-hidden /> : <Icon size={13} aria-hidden />}
                        {p.label}
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
                <span className={sim.error ? "font-medium text-red-600" : "text-ink"}>{sim.status}</span>
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
        ) : (
          // ── FACE 2 — operations deck ──
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-3">
              <CandiSwitch open onClick={() => setCollapsed(true)} busy={aiBusy} />
              <div className="hidden flex-col leading-tight lg:flex">
                <span className="text-meta font-semibold uppercase tracking-wide text-coral">{t("title")}</span>
                <span className="text-sm font-medium text-steel">{t("operations")}</span>
              </div>
              {awaiting > 0 ? (
                <button
                  type="button"
                  onClick={openDecisions}
                  title={t("openDecisions")}
                  className="focus-ring inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-coral/40 bg-coral/5 px-2.5 text-sm font-semibold text-coral transition-colors hover:bg-coral/10"
                >
                  <span className="grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-coral px-1 text-meta font-bold text-white nums">
                    {awaiting > 99 ? t("countOverflow") : awaiting}
                  </span>
                  {t("needYou")}
                </button>
              ) : null}
              <div className="min-w-[240px] flex-1">
                <CommandBar onExecuted={() => notifyDataChanged()} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <DeckTile
                  icon={Sparkles}
                  label={batch ? t("screening") : t("aiScreen")}
                  sublabel={batch ? `${batch.progressDone}/${batch.progressTotal}` : undefined}
                  onClick={() => void startTask("batch_screen")}
                  disabled={!!batch}
                  active={!!batch}
                />
                <DeckTile icon={Wand2} label={t("automationPass")} onClick={() => void pass.dryRun()} active={!!pass.preview} disabled={pass.busy} />
                <DeckTile icon={Clock} label={t("schedule")} onClick={() => setScheduleOpen((o) => !o)} active={scheduleOpen} />
                <DeckTile icon={Play} label={t("guidedTour")} onClick={sim.start} />
              </div>
            </div>

            {pass.committed || pass.error ? (
              <div className="pl-14">
                <PassStrip pass={pass} />
              </div>
            ) : null}

            {scheduleOpen ? (
              <div className="pl-14">
                <SchedulerControl onRan={() => notifyDataChanged()} />
              </div>
            ) : null}
          </div>
        )}
      </div>
      </div>
    </>
  );
}
