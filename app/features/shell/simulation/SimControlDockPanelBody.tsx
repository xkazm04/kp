"use client";

// LAYER 2 — the ONE exclusive panel, resolved from the dock's single `panel`
// state. Split out of SimControlDock.tsx when round 3 added the fourth panel:
// the dock file was at the 200-line cap, and this switch is the part of it that
// grows every time a panel is added, so it is the piece that had to leave.
//
// The five bodies are deliberately unlike each other — a console, an automations
// deck, an imported command line, an imported scheduler, and (round V3) the
// companion's own input. What they share is the slot, which is why the
// exclusivity lives in the caller's state and not here.
//
// `candi` takes no props at all: the conversation lives in `CompanionDockProvider`
// above both this dock and the voice strip, and the panel reads it from there.
// Threading `send` down through this switch would make five simulation files
// carry something only one of them looks at.
import type { ReadonlyURLSearchParams, useRouter } from "next/navigation";
import { CommandBar } from "@/app/features/hiring/pipeline/CommandBar";
import { SchedulerControl } from "@/app/features/hiring/pipeline/SchedulerControl";
import { CompanionInputPanel } from "@/app/features/shell/companion/CompanionInputPanel";
import { notifyDataChanged } from "@/app/features/shell/live-refresh";
import type { useTasks } from "@/app/features/shell/tasks/TasksProvider";
import type { useAutomationPass } from "./simControlCenterKit";
import type { useSimulation } from "./SimulationProvider";
import { SimControlDockOpsFace } from "./SimControlDockOpsFace";
import { SimControlDockSimFace } from "./SimControlDockSimFace";
import type { DockPanelId } from "./simControlDockLayers";

export function SimControlDockPanelBody({
  panel,
  sim,
  router,
  searchParams,
  activeIdx,
  last,
  isPublicDemo,
  batch,
  startTask,
  pass,
}: {
  panel: DockPanelId;
  sim: ReturnType<typeof useSimulation>;
  router: ReturnType<typeof useRouter>;
  searchParams: ReadonlyURLSearchParams;
  activeIdx: number;
  last: string | undefined;
  isPublicDemo: boolean;
  batch: ReturnType<ReturnType<typeof useTasks>["findActive"]>;
  startTask: ReturnType<typeof useTasks>["startTask"];
  pass: ReturnType<typeof useAutomationPass>;
}) {
  switch (panel) {
    case "sim":
      return (
        <SimControlDockSimFace
          sim={sim}
          router={router}
          searchParams={searchParams}
          activeIdx={activeIdx}
          last={last}
          isPublicDemo={isPublicDemo}
        />
      );
    case "ops":
      return <SimControlDockOpsFace batch={batch} startTask={startTask} pass={pass} />;
    case "schedule":
      // Promoted out of the ops panel, where it was a tile that unrolled this
      // same control beneath the other tiles. Imported, not forked — the dock
      // shows the pipeline's own scheduler, so there is one clock, not two.
      return <SchedulerControl onRan={() => notifyDataChanged()} />;
    case "command":
      return <CommandBar onExecuted={() => notifyDataChanged()} />;
    case "candi":
      // Offered only in the VOICE interface mode — see `candiControl()`. In
      // window mode this id is never selected, because the row's Candi control
      // is an action that raises the left dock instead.
      return <CompanionInputPanel />;
  }
}
