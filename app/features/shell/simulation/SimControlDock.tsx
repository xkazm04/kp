"use client";

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { buildUrl } from "@/app/features/shell/tabs";
import { useTasks } from "@/app/features/shell/tasks/TasksProvider";
import { useAttention } from "@/app/features/shell/useAttention";
import { PassPreviewModal } from "@/app/features/hiring/pipeline/PassPreviewModal";
import { useOptionalCompanionDock } from "@/app/features/shell/companion/CompanionDockProvider";
import { SIM_PHASES } from "./constants";
import { useSimulation } from "./SimulationProvider";
import { useAutomationPass, useControlMode, usePublishBarHeight } from "./simControlCenterKit";
import { SimControlDockOrb } from "./SimControlDockOrb";
import { SimControlDockPanelBody } from "./SimControlDockPanelBody";
import { DockBrand, DockGuide } from "./SimControlDockRail";
import { SimControlDockToolbar } from "./SimControlDockToolbar";
import { dockPanelSlot } from "./dockPanelSlot";
import { useDockPanelEffects } from "./useDockPanelEffects";
import {
  DOCK_PANEL_DOM_ID,
  candiControl,
  dockTabDomId,
  effectiveDockPanel,
  type DockPanelId,
} from "./simControlDockLayers";

/*
 * "Flight Deck", round 3 — a two-layer toolbar with a rail beside it.
 *
 * Metaphor unchanged: a mission-control console pinned to the bottom edge, raised
 * and lowered by the Candi orb, whose collapsed rest state (halo, beacon, aiBusy
 * pulse) no round has touched. Round 2 replaced two full faces with LAYER 1 (a
 * compact icon row) over LAYER 2 (ONE panel it opens above itself, on a single
 * `panel` state, so mutual exclusion is structural rather than an effect).
 *
 * Round 3 finishes that exclusivity — the scheduler was still a tile INSIDE the
 * ops panel on its own boolean, so promoting it to a fourth panel means one
 * surface at a time holds inside the panel too — and spends the footer's spare
 * width on a RAIL: the identity block outside the box's left border, the guided
 * demo's single entry outside its right (SimControlDockRail.tsx). The demo had
 * two doors to the same `sim.start()`; it now has one.
 *
 * Round V3 finishes it in the other direction. "Ask Candi" was the deliberate
 * exception — an ACTION raising a competing floating window — and in the VOICE
 * interface mode there is no longer a competing window to raise: her answer is a
 * strip at the top of the screen, so the thing the footer should own is the
 * INPUT. In that mode she becomes the `candi` layer-2 panel and inherits the
 * exclusivity for free; in window mode she is still the action she was. The
 * whole of that difference is `candiControl()`, and her panel's openness is
 * `companion.open` itself rather than a second copy in this file's `panel`
 * state — joined during render by `effectiveDockPanel()`, never by an effect.
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
  // effect below handles the live ops → sim transition. Ops rest state is collapsed.
  const [collapsed, setCollapsed] = useState(mode !== "sim");
  // THE single layer-2 slot. Its initial value is the face the old dock would have
  // shown, so raising the deck lands on the same content it always did. It never
  // holds "candi": that panel's state is the companion's own `open`, joined below.
  const [panel, setPanel] = useState<DockPanelId | null>(mode === "sim" ? "sim" : "ops");
  const candi = candiControl(companion !== null, companion?.prefs.mode ?? "dock");
  const shown = effectiveDockPanel(panel, candi, companion?.open ?? false);
  const railRef = useRef<HTMLDivElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  // Whether the orb should take focus when it appears. True only when the OPERATOR
  // lowered the deck — the orb is then the control that replaced the one they were
  // standing on. A page that simply loads collapsed must not grab focus.
  const [focusOrb, setFocusOrb] = useState(false);
  // ResizeObserver-backed on whichever of the two the deck currently IS — the whole
  // footer ROW when raised (panel + both rail elements, so a layer-2 open/close
  // republishes for free), the orb when down. ONE call switching refs rather than
  // two calls with an `active` flag each: two effects would race to own the same
  // custom property, and whichever ran last would win by declaration order.
  usePublishBarHeight(collapsed ? orbRef : railRef, true);

  useDockPanelEffects({
    mode,
    collapsed,
    setCollapsed,
    shown,
    setPanel,
    modalUp: Boolean(pass.preview),
    closeDock: companion?.closeDock,
  });

  const batch = findActive((t) => t.kind === "batch_screen");
  const aiBusy = sim.running || pass.busy || !!batch;
  const isPublicDemo = searchParams.get("sim") === "auto";
  const activeIdx = sim.phase ? SIM_PHASES.findIndex((p) => p.id === sim.phase) : -1;
  const last = sim.log[sim.log.length - 1]?.text;
  // The awaiting-a-human-decision count (the same number the sidebar Decisions
  // badge shows) — it beacons the collapsed orb and gives the layer-1 row a
  // one-click route to what actually needs the recruiter.
  const awaiting = attention?.decisions ?? 0;
  const openDecisions = () => router.push(buildUrl({ tab: "decisions" }, searchParams.toString()));

  // The dry-run preview reuses the pipeline's rich look-before-commit modal
  // (reject-first, per-candidate), fed the board entries so each row names a
  // person. Rendered collapsed AND expanded, so it survives a collapse.
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
          containerRef={orbRef}
          focusOnMount={focusOrb}
          onOpen={() => {
            setFocusOrb(false);
            setCollapsed(false);
            setPanel((cur) => cur ?? (mode === "sim" ? "sim" : "ops"));
          }}
        />
      </>
    );
  }

  const { selectPanel, askCandi, onGuide } = dockPanelSlot({
    panel: shown,
    setPanel,
    mode,
    companion,
    candi,
    startSim: sim.start,
  });

  return (
    <>
      {passModal}
      <div
        ref={railRef}
        // The row is no longer a full-bleed opaque bar, so the transparent strip
        // around it must not swallow clicks meant for the page behind: the frame
        // is pointer-events-none and each of the three parts opts back in.
        className="animate-fade-in pointer-events-none fixed inset-x-0 bottom-0 z-[var(--z-sim-bar)] px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        {/* The fixed footer ROW: rail · panel · rail. `items-end` keeps both side
            elements on the toolbar's baseline while the panel grows upward, and
            `min-w-0 flex-1` is what stops the box colliding with them. */}
        <div className="mx-auto flex max-w-[1600px] items-end gap-3">
          <DockBrand
            aiBusy={aiBusy}
            onCollapse={() => {
              // Lowering the deck destroys the control that was focused, so the
              // orb that replaces it takes the focus rather than letting it fall
              // to the body — the same courtesy Escape does for a panel.
              setFocusOrb(true);
              setCollapsed(true);
            }}
          />
          <div className="pointer-events-auto min-w-0 flex-1 rounded-xl border-2 border-stone-300 bg-white/95 px-4 py-3 shadow-panel backdrop-blur dark:rounded-2xl">
            {/* ── LAYER 2 — the one exclusive panel, above the row that opened it ── */}
            {shown ? (
              <div
                key={shown}
                id={DOCK_PANEL_DOM_ID}
                role="region"
                aria-labelledby={dockTabDomId(shown)}
                className="animate-fade-in mb-3 border-b border-stone-200 pb-3"
              >
                <SimControlDockPanelBody
                  panel={shown}
                  sim={sim}
                  router={router}
                  searchParams={searchParams}
                  activeIdx={activeIdx}
                  last={last}
                  isPublicDemo={isPublicDemo}
                  batch={batch}
                  startTask={startTask}
                  pass={pass}
                />
              </div>
            ) : null}

            {/* ── LAYER 1 — always visible; the way into every panel but the demo ── */}
            <SimControlDockToolbar
              panel={shown}
              awaiting={awaiting}
              openDecisions={openDecisions}
              onSelectPanel={selectPanel}
              onAskCandi={askCandi}
              candi={candi}
              companionOpen={companion?.open ?? false}
            />
          </div>
          <DockGuide open={shown === "sim"} onClick={onGuide} />
        </div>
      </div>
    </>
  );
}
