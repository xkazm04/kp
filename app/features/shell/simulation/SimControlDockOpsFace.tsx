"use client";

// FACE 2 — the operations deck, split out of SimControlDock.tsx so it stays under
// the 200-line file cap. Verbatim markup: command bar + automation module tiles,
// the awaiting-decisions pill, and the pass-strip/scheduler drawers underneath.
import { Clock, Sparkles, Wand2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { CommandBar } from "@/app/features/hiring/pipeline/CommandBar";
import { SchedulerControl } from "@/app/features/hiring/pipeline/SchedulerControl";
import { notifyDataChanged } from "@/app/features/shell/live-refresh";
import type { useTasks } from "@/app/features/shell/tasks/TasksProvider";
import type { useAutomationPass } from "./simControlCenterKit";
import { CandiSwitch, DeckTile, GuidedDemoTile, PassStrip } from "./SimControlDockTiles";

export function SimControlDockOpsFace({
  aiBusy,
  awaiting,
  openDecisions,
  batch,
  startTask,
  pass,
  scheduleOpen,
  setScheduleOpen,
  onStartTour,
  onCollapse,
}: {
  aiBusy: boolean;
  awaiting: number;
  openDecisions: () => void;
  batch: ReturnType<ReturnType<typeof useTasks>["findActive"]>;
  startTask: ReturnType<typeof useTasks>["startTask"];
  pass: ReturnType<typeof useAutomationPass>;
  scheduleOpen: boolean;
  setScheduleOpen: (updater: (open: boolean) => boolean) => void;
  onStartTour: () => void;
  onCollapse: () => void;
}) {
  const t = useTranslations("pipeline.controlCenter");
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <CandiSwitch open onClick={onCollapse} busy={aiBusy} />
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
          <GuidedDemoTile label={t("guidedTour")} onClick={onStartTour} />
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
  );
}
