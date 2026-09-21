"use client";

// The candidate modal's ONE action bar — visible on every tab. It replaced two action
// interfaces (the Scorecard's footer and the Actions tab) that offered overlapping
// doors to the same operations.
//
//   [ move to step ▾ ]  [ AI actions this step offers… ]  [ voice link ] [ scheduling link ]   [ Move to {next} → ]
//
// Which AI actions appear is the column's rule (app/_lib/stage-ai-actions.ts): the
// workspace's own list from Settings → Hiring, else the product default by role —
// the same rule the server enforces on a manual run. What an action or a link
// produces opens in the TRAY above the bar (CandidateFooterTray), so the tab being
// read stays where it is.

import { useState } from "react";
import {
  ArrowRight,
  Ban,
  Banknote,
  CalendarClock,
  ClipboardList,
  Mail,
  Mic,
  Shuffle,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Select } from "@/app/_components/Select";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY } from "@/app/_components/ui/recipes";
import type { StageAiAction, StageDef } from "@/app/_lib/pipeline-stages";
import { offeredStageActions } from "@/app/_lib/stage-ai-actions";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import { moveStageSelectValues } from "../../pipelineMoveTargets";
import type { CandidateState } from "../state/useCandidateState";
import { CandidateFooterTray, type TrayView } from "./CandidateFooterTray";

const ACTION_ICON: Record<StageAiAction, LucideIcon> = {
  screen: UserCheck,
  prep: ClipboardList,
  scorecard: ClipboardList,
  offer: Banknote,
  outreach: Mail,
  rejection: Ban,
  rematch: Shuffle,
};

const LINK_BTN = `${BTN_SECONDARY} h-9 cursor-pointer gap-1.5 bg-white px-2.5 text-sm`;

export function CandidateFooter({
  entry,
  axis,
  st,
  nextStage,
  stageLabel,
  labelOf,
}: {
  entry: Entry;
  axis: readonly StageDef[];
  st: CandidateState;
  nextStage: StageDef | null;
  stageLabel: (stage: StageDef) => string;
  /** A stage id's display label (workspace-renamed or catalog). */
  labelOf: (stageId: string) => string;
}) {
  const t = useTranslations("pipeline.candidate.footer");
  const tDrawer = useTranslations("pipeline.drawer");
  const tActions = useTranslations("pipeline.actions");
  const tScore = useTranslations("pipeline.candidate.scorecard");
  const [tray, setTray] = useState<TrayView | null>(null);
  const actions = offeredStageActions(entry, axis);
  const active = entry.status === "active";
  const toggle = (view: TrayView) => setTray((current) => (current === view ? null : view));
  const run = (id: StageAiAction) => {
    setTray("result");
    void st.run(id, st.candNote);
  };

  return (
    <footer aria-label={t("aria")} className="shrink-0 border-t border-stone-200 bg-white">
      {tray ? <CandidateFooterTray view={tray} entry={entry} st={st} onClose={() => setTray(null)} /> : null}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
        {active ? (
          <Select
            ariaLabel={t("moveStage")}
            value={entry.stage}
            disabled={st.movingStage}
            onChange={(to) => void st.moveStage(to)}
            sizeVariant="sm"
            className="w-44"
            options={moveStageSelectValues(entry.stage, axis).map((id) => ({
              value: id,
              label: `${labelOf(id)}${id === entry.stage ? tDrawer("current") : ""}`,
            }))}
          />
        ) : null}

        <div role="group" aria-label={tDrawer("aiActions")} className="flex flex-wrap items-center gap-1.5">
          {actions.length === 0 ? (
            <span className="text-sm text-steel">{t("noActions")}</span>
          ) : (
            actions.map((id) => {
              const Icon = ACTION_ICON[id];
              const running = st.busy === id;
              const last = st.result?.task === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => run(id)}
                  disabled={st.busy !== null}
                  aria-busy={running}
                  className={`focus-ring inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-sm font-semibold transition-colors disabled:cursor-wait disabled:opacity-50 ${
                    last ? "border-coral bg-coral/5 text-coral" : "border-stone-200 bg-white text-ink hover:border-coral/40"
                  }`}
                >
                  <Icon size={14} className="shrink-0 text-coral" aria-hidden />
                  {running ? tDrawer("working") : tActions(id)}
                </button>
              );
            })
          )}
        </div>

        {st.showLinks ? (
          <>
            <button type="button" aria-expanded={tray === "voice"} onClick={() => toggle("voice")} className={LINK_BTN}>
              <Mic size={14} className="text-coral" aria-hidden /> {t("voiceLink")}
            </button>
            <button type="button" aria-expanded={tray === "schedule"} onClick={() => toggle("schedule")} className={LINK_BTN}>
              <CalendarClock size={14} className="text-coral" aria-hidden /> {t("scheduleLink")}
            </button>
          </>
        ) : null}

        {tray !== "result" && (st.result || st.error) ? (
          <button type="button" onClick={() => setTray("result")} className={`${BTN_GHOST} h-9 cursor-pointer px-2 text-sm`}>
            {t("showResult")}
          </button>
        ) : null}

        {active && nextStage ? (
          <button
            type="button"
            onClick={() => void st.moveStage(nextStage.id)}
            disabled={st.movingStage}
            aria-busy={st.movingStage}
            className={`${BTN_PRIMARY} ml-auto h-9 cursor-pointer px-3 text-sm disabled:cursor-wait`}
          >
            {tScore("advance", { stage: stageLabel(nextStage) })}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {/* The move's refusal (409 changed-since, 422 route-through), already localized. */}
      {st.moveErr ? (
        <p role="alert" className="px-4 pb-3 text-sm text-red-700 sm:px-6">
          {st.moveErr}
        </p>
      ) : null}
    </footer>
  );
}
