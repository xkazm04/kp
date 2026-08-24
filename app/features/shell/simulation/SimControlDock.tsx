"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { buildUrl } from "@/app/features/shell/tabs";
import { useTasks } from "@/app/features/shell/tasks/TasksProvider";
import { useAttention } from "@/app/features/shell/useAttention";
import { CommandBar } from "@/app/features/hiring/pipeline/CommandBar";
import { PassPreviewModal } from "@/app/features/hiring/pipeline/PassPreviewModal";
import { useOptionalCompanionDock } from "@/app/features/shell/companion/CompanionDockProvider";
import { notifyDataChanged } from "@/app/features/shell/live-refresh";
import { SIM_PHASES } from "./constants";
import { useSimulation } from "./SimulationProvider";
import { useAutomationPass, useControlMode, usePublishBarHeight } from "./simControlCenterKit";
import { SimControlDockSimFace } from "./SimControlDockSimFace";
import { SimControlDockOpsFace } from "./SimControlDockOpsFace";
import { SimControlDockOrb } from "./SimControlDockOrb";
import { DOCK_PANEL_DOM_ID, dockTabDomId, SimControlDockToolbar } from "./SimControlDockToolbar";
import { toggleDockPanel, type DockPanelId } from "./simControlDockLayers";

/*
 * "Flight Deck", round 2 — a TWO-LAYER toolbar.
 *
 * Metaphor unchanged: a mission-control console pinned to the bottom edge, raised
 * and lowered by the Candi orb, whose collapsed rest state (halo, awaiting-decisions
 * beacon, aiBusy pulse) this redesign does not touch. What changed is the EXPANDED
 * state: two full faces picked for you by the run state — each with its own chrome
 * and its own always-mounted extras, so the command line occupied the deck whether
 * or not anyone was typing — became one compact always-visible icon row (LAYER 1)
 * over ONE panel it opens above itself (LAYER 2, a single `panel` state).
 *
 * Mutual exclusion is therefore structural: one slot, so a second panel cannot
 * exist. "Ask Candi" is the deliberate exception — an ACTION raising the companion
 * dock, which counts as the competing surface, so it closes the open panel instead
 * of becoming one (and, symmetrically, opening a panel lowers the companion dock).
 */

export function ControlDock() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sim = useSimulation();
  const mode = useControlMode();
  const { startTask, findActive } = useTasks();
  const pass = useAutomationPass();
  const attention = useAttention();
  // Null on the deep-link pages, which render no companion dock — "Ask Candi" is
  // then omitted rather than rendered as a control that does nothing.
  const companion = useOptionalCompanionDock();

  // Start raised when the page loads straight into a demo (public ?sim=auto); the
  // effect below then handles the live ops → sim transition. Ops rest state is collapsed.
  const [collapsed, setCollapsed] = useState(mode !== "sim");
  // THE single layer-2 slot. Its initial value is the face the old dock would have
  // shown, so raising the deck lands on the same content it always did.
  const [panel, setPanel] = useState<DockPanelId | null>(mode === "sim" ? "sim" : "ops");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  // ResizeObserver-backed, so opening/closing a layer-2 panel republishes the
  // height the sim overlays anchor above without any extra wiring here.
  usePublishBarHeight(panelRef, !collapsed);

  // Raise the deck automatically the moment a demo begins (ops → sim), so the tour
  // is visible without hunting for the switch. Fires on the transition only — the
  // viewer can still lower it mid-run.
  const prevMode = useRef(mode);
  useEffect(() => {
    if (mode === "sim" && prevMode.current !== "sim") {
      setCollapsed(false);
      setPanel("sim");
    }
    prevMode.current = mode;
  }, [mode]);

  // Escape closes the OPEN PANEL, not the deck — the layer-1 row stays put, which
  // is the affordance that says how to get the panel back. Suspended while the
  // dock's own dry-run modal is up so Escape reaches the dialog first.
  useEffect(() => {
    if (collapsed || panel === null || pass.preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapsed, panel, pass.preview]);

  const batch = findActive((t) => t.kind === "batch_screen");
  const aiBusy = sim.running || pass.busy || !!batch;
  const isPublicDemo = searchParams.get("sim") === "auto";
  const activeIdx = sim.phase ? SIM_PHASES.findIndex((p) => p.id === sim.phase) : -1;
  const last = sim.log[sim.log.length - 1]?.text;
  // The awaiting-a-human-decision count (the same number the sidebar Decisions
  // badge shows) — it turns the collapsed orb into a live beacon and gives the
  // layer-1 row a one-click route to what actually needs the recruiter.
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

  if (collapsed) {
    return (
      <>
        {passModal}
        <SimControlDockOrb
          mode={mode}
          activeIdx={activeIdx}
          simDone={sim.done}
          awaiting={awaiting}
          aiBusy={aiBusy}
          onOpen={() => {
            setCollapsed(false);
            setPanel((cur) => cur ?? (mode === "sim" ? "sim" : "ops"));
          }}
        />
      </>
    );
  }

  // Rule (b), both directions: picking a layer-1 option opens exactly one panel
  // (or closes the active one), and whichever it opens lowers the companion dock.
  const selectPanel = (id: DockPanelId) => {
    const next = toggleDockPanel(panel, id);
    setPanel(next);
    if (next !== null) companion?.closeDock();
  };
  const askCandi = companion
    ? () => {
        setPanel(null);
        companion.openDock();
      }
    : null;

  return (
    <>
      {passModal}
      <div
        ref={panelRef}
        className="fixed inset-x-0 bottom-0 z-[var(--z-sim-bar)] animate-fade-in border-t-2 border-stone-300 bg-white/95 shadow-panel backdrop-blur"
      >
        <div className="mx-auto max-w-[1600px] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {/* ── LAYER 2 — the one exclusive panel, above the row that opened it ── */}
          {panel ? (
            <div
              key={panel}
              id={DOCK_PANEL_DOM_ID}
              role="region"
              aria-labelledby={dockTabDomId(panel)}
              className="animate-fade-in mb-3 border-b border-stone-200 pb-3"
            >
              {panel === "sim" ? (
                <SimControlDockSimFace
                  sim={sim}
                  router={router}
                  searchParams={searchParams}
                  activeIdx={activeIdx}
                  last={last}
                  isPublicDemo={isPublicDemo}
                />
              ) : panel === "ops" ? (
                <SimControlDockOpsFace
                  batch={batch}
                  startTask={startTask}
                  pass={pass}
                  scheduleOpen={scheduleOpen}
                  setScheduleOpen={setScheduleOpen}
                  onStartTour={sim.start}
                />
              ) : (
                <CommandBar onExecuted={() => notifyDataChanged()} />
              )}
            </div>
          ) : null}

          {/* ── LAYER 1 — always visible; the only way into a layer-2 panel ── */}
          <SimControlDockToolbar
            mode={mode}
            panel={panel}
            aiBusy={aiBusy}
            awaiting={awaiting}
            openDecisions={openDecisions}
            onSelectPanel={selectPanel}
            onAskCandi={askCandi}
            companionOpen={companion?.open ?? false}
            onCollapse={() => setCollapsed(true)}
          />
        </div>
      </div>
    </>
  );
}
