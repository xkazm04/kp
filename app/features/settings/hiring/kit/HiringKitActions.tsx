"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, ChipRow, Clip, Section, SettingRow } from "@/app/_components/kit";
import { STAGE_AI_ACTIONS, type StageAiAction } from "@/app/_lib/pipeline-stages";
import { isDefaultStageActions } from "@/app/_lib/stage-ai-actions";
import { setStageActions } from "@/app/features/shared/pipelineAxisDraft";
import { useStageDisplayLabel } from "@/app/features/shared/usePipelineAxisCopy";
import { actionRows, type Composer } from "./hiringKitModel";

/**
 * Which AI actions a recruiter can run on a candidate at each step (StageActionsPicker's job).
 * One setting row per step: the offered actions as its consequence line; "Choose" opens the
 * row's detail line with one chip per action, pressed when offered, the product default named in
 * its tip. Same rule as the picker: a selection equal to the default stores nothing, so the step
 * keeps following the default; "Reset to default" does that explicitly.
 */
export function HiringKitActions({ c }: { c: Composer }) {
  const t = useTranslations("hiringPlan.steps");
  const tk = useTranslations("hiringPlan.kit");
  const tActions = useTranslations("pipeline.actions");
  const display = useStageDisplayLabel();
  const [open, setOpen] = useState<string | null>(null);
  const draft = c.axis;
  if (!draft) return null;
  const saved = new Map(c.savedStages.map((s) => [s.id, JSON.stringify(s.actions ?? null)]));
  const set = (id: string, actions: readonly StageAiAction[] | undefined) => c.setAxis(setStageActions(draft, id, actions));

  return (
    <Section title={t("colActions")} state={t("actionsHint")}>
      {actionRows(draft.stages).map((r) => {
        const stage = draft.stages.find((s) => s.id === r.id)!;
        const label = display(stage);
        const isOpen = open === r.id;
        const toggle = (id: StageAiAction) => {
          const next = STAGE_AI_ACTIONS.filter((a) => (a === id ? !r.current.includes(a) : r.current.includes(a)));
          set(r.id, isDefaultStageActions(r.id, next, draft.stages) ? undefined : next);
        };
        const changed = saved.has(r.id) ? saved.get(r.id) !== JSON.stringify(stage.actions ?? null) : stage.actions !== undefined;
        return (
          <SettingRow
            key={r.id}
            name={label}
            sub={r.custom ? t("actionsCustom") : t("actionsDefault")}
            consequence={<Clip text={r.current.length === 0 ? t("actionsNone") : r.current.map((a) => tActions(a)).join(" · ")} />}
            control={
              <Button
                label={isOpen ? tk("actionsDone") : tk("actionsEdit")}
                size="sm"
                aria-expanded={isOpen}
                // The visible word leads the name (label-in-name), the step follows it.
                aria-label={`${isOpen ? tk("actionsDone") : tk("actionsEdit")} · ${t("actionsAria", { stage: label })}`}
                onClick={() => setOpen(isOpen ? null : r.id)}
              />
            }
            actions={
              r.custom ? (
                <Button label={t("actionsReset")} icon="resend" iconOnly size="sm" variant="ghost" onClick={() => set(r.id, undefined)} />
              ) : null
            }
            state={changed ? ["changed"] : []}
            detail={
              isOpen ? (
                <ChipRow
                  chips={STAGE_AI_ACTIONS.map((id) => ({
                    id,
                    label: tActions(id),
                    pressed: r.current.includes(id),
                    tip: r.defaults.includes(id) ? t("actionsDefault") : undefined,
                    onPress: () => toggle(id),
                  }))}
                />
              ) : undefined
            }
          />
        );
      })}
    </Section>
  );
}
