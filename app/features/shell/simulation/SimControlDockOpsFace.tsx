"use client";

// LAYER-2 PANEL "ops" — the automations deck (label: "Automations"; the panel id
// and its i18n KEY stay `ops`, because an identifier is not a caption). Was one
// of the dock's two faces; the two-layer redesign turned it into a panel body,
// so the chrome it used to carry (the Candi switch, the title block, the
// awaiting-decisions pill) moved UP into the layer-1 toolbar, and the two
// controls that became layer-1 options of their own — the free-text command bar
// and "Ask Candi" — left with it.
//
// Round 3 took the last two: the scheduler tile, which unrolled SchedulerControl
// underneath on its own `scheduleOpen` boolean (the one surface in the dock that
// could still be open beside another), became a first-class layer-2 panel; and
// the "Guided tour" tile, which called the same `sim.start()` the layer-1 guided
// demo reached, went to the single guide button outside the panel's right border.
// What remains is exactly the automation modules that act on the board.
import { Sparkles, Wand2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { useTasks } from "@/app/features/shell/tasks/TasksProvider";
import type { useAutomationPass } from "./simControlCenterKit";
import { DeckTile, PassStrip } from "./SimControlDockTiles";

export function SimControlDockOpsFace({
  batch,
  startTask,
  pass,
}: {
  batch: ReturnType<ReturnType<typeof useTasks>["findActive"]>;
  startTask: ReturnType<typeof useTasks>["startTask"];
  pass: ReturnType<typeof useAutomationPass>;
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
      </div>

      {pass.committed || pass.error ? <PassStrip pass={pass} /> : null}
    </div>
  );
}
