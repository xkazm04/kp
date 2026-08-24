"use client";

// LAYER-2 PANEL "ops" — the operations deck. Was one of the dock's two faces; the
// two-layer redesign turned it into a panel body, so the chrome it used to carry
// (the Candi switch, the title block, the awaiting-decisions pill) moved UP into
// the layer-1 toolbar, and the two controls that became layer-1 options of their
// own — the free-text command bar and "Ask Candi" — left with it. What remains is
// exactly the automation modules and the drawers they unroll.
import { Clock, Sparkles, Wand2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { SchedulerControl } from "@/app/features/hiring/pipeline/SchedulerControl";
import { notifyDataChanged } from "@/app/features/shell/live-refresh";
import type { useTasks } from "@/app/features/shell/tasks/TasksProvider";
import type { useAutomationPass } from "./simControlCenterKit";
import { DeckTile, GuidedDemoTile, PassStrip } from "./SimControlDockTiles";

export function SimControlDockOpsFace({
  batch,
  startTask,
  pass,
  scheduleOpen,
  setScheduleOpen,
  onStartTour,
}: {
  batch: ReturnType<ReturnType<typeof useTasks>["findActive"]>;
  startTask: ReturnType<typeof useTasks>["startTask"];
  pass: ReturnType<typeof useAutomationPass>;
  scheduleOpen: boolean;
  setScheduleOpen: (updater: (open: boolean) => boolean) => void;
  onStartTour: () => void;
}) {
  const t = useTranslations("pipeline.controlCenter");
  return (
    <div className="space-y-2.5">
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
        <GuidedDemoTile label={t("guidedTour")} onClick={onStartTour} />
      </div>

      {pass.committed || pass.error ? <PassStrip pass={pass} /> : null}

      {scheduleOpen ? <SchedulerControl onRan={() => notifyDataChanged()} /> : null}
    </div>
  );
}
