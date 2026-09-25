"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, ChipRow, FlowTable, Mark, Note, Section, TextField, type Column } from "@/app/_components/kit";
import { Select } from "@/app/_components/Select";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { STAGE_AI_ACTIONS, type StageAiAction } from "@/app/_lib/pipeline-stages";
import { isDefaultStageActions } from "@/app/_lib/stage-ai-actions";
import {
  addStage, ASSIGNABLE_ROLES, AXIS_MAX_STAGES, moveStage, removeStage, renameStage, setStageActions, setStageRole,
} from "@/app/features/shared/pipelineAxisDraft";
import { usePipelineAxisProblemText, usePipelineStageRoleLabel, useStageDisplayLabel } from "@/app/features/shared/usePipelineAxisCopy";
import { latestVersion, matrixRows, type Composer, type MatrixRow } from "./hiringKitModel";
import { policyCells } from "./HiringKitCells";

/**
 * The pipeline as ONE matrix, a row per step - today's table, on the measure: the name is the field
 * (the type and who stands there on its quiet line), the type and the AI actions in meta, the
 * cohort in meta+1, the executor and the guard in fig / time, reorder and remove in act. At a sheet of
 * 1000px or less the cohort folds (it reappears in the row's detail line); everything else stays.
 * Every edit goes through the model the current table uses; nothing is stored until Save.
 */
export function HiringKitMatrix({ c }: { c: Composer }) {
  const t = useTranslations("hiringPlan");
  const ts = useTranslations("hiringPlan.steps");
  const tActions = useTranslations("pipeline.actions");
  const fmt = useDateFormat();
  const roleLabel = usePipelineStageRoleLabel();
  const display = useStageDisplayLabel();
  const problemText = usePipelineAxisProblemText();
  const [open, setOpen] = useState<string | null>(null);
  const draft = c.axis;
  const plan = c.plan;
  if (!draft || !plan) return null;
  const rows = matrixRows(draft, c.savedStages, c.counts, c.countsLoaded, plan, c.savedPlan);
  const stored = latestVersion(c.versions, ["pipelineStages", "interviewPlan"]);
  const roleOptions = ASSIGNABLE_ROLES.map((r) => ({ value: r, label: roleLabel(r) }));
  const setActions = (id: string, next: readonly StageAiAction[] | undefined) => c.setAxis(setStageActions(draft, id, next));

  const columns: Column[] = [
    { id: "mark", label: "", track: "mark" },
    // The heads carry the sentences the pre-kit table printed above itself and in its picker:
    // renaming never moves the stored key, and what an AI action is.
    { id: "name", label: t("colLabel"), track: "name", primary: true, tip: ts("intro") },
    { id: "type", label: `${t("colStation")} · ${ts("colActions")}`, track: "meta", tip: ts("actionsHint") },
    { id: "cohort", label: t("colCohort"), track: "meta+1" },
    { id: "exec", label: t("colExecutor"), track: "fig" },
    { id: "guard", label: t("colGuard"), track: "time" },
    { id: "act", label: "", track: "act" },
  ];

  const markOf = (r: MatrixRow) => {
    if (r.invalid) return <Mark kind="caution" tip={ts(r.label.trim() ? "problemDuplicateLabel" : "problemEmptyLabel", { label: r.label.trim() })} />;
    if (r.stacked) return <Mark kind="caution" tip={t("tipStackedRounds", { count: r.stacked })} />;
    return <Mark kind={r.decider} tip={r.decider === "human" ? t("gateHuman") : r.decider === "machine" ? t("impact.unattended") : t("impact.noRounds")} />;
  };

  const cells = (r: MatrixRow) => {
    const stage = display(r);
    const p = policyCells(t, c, r.policy, stage);
    const where = !r.saved ? ts("new") : r.count == null ? null : t("impact.occupancy", { count: r.count });
    const sub = [roleLabel(r.role), where, r.stacked ? t("stackedRounds", { count: r.stacked }) : null].filter(Boolean).join(" · ");
    const aria = { stage: r.label || r.id };
    const isOpen = open === r.id;
    return [
      markOf(r),
      <>
        <TextField
          size="sm"
          label={ts("labelAria", { position: rows.indexOf(r) + 1 })}
          value={r.label}
          invalid={r.invalid}
          tip={r.saved ? `${ts("idTitle")} (${r.id})` : ts("new")}
          onChange={(v) => c.setAxis(renameStage(draft, r.id, v))}
        />
        <small>{sub}</small>
      </>,
      <span className="flex items-center gap-2" key="type">
        <Select
          value={r.role}
          options={roleOptions}
          ariaLabel={ts("roleAria", aria)}
          sizeVariant="sm"
          className="w-36 shrink-0"
          onChange={(role) => c.setAxis(setStageRole(draft, r.id, role as (typeof ASSIGNABLE_ROLES)[number]))}
        />
        <Button
          label={r.actions.current.length === 0 ? ts("actionsNone") : ts("actionsCount", { count: r.actions.current.length })}
          size="sm"
          aria-expanded={isOpen}
          aria-label={ts("actionsAria", { stage })}
          tip={`${r.actions.custom ? ts("actionsCustom") : ts("actionsDefault")}: ${r.actions.current.map((a) => tActions(a)).join(" · ") || ts("actionsNone")}`}
          onClick={() => setOpen(isOpen ? null : r.id)}
        />
      </span>,
      p.cohort,
      p.executor,
      p.guard,
      <span className="flex justify-end gap-1" key="act">
        <Button label={ts("moveUpAria", aria)} icon="up" iconOnly size="sm" variant="ghost" disabled={r.first} onClick={() => c.setAxis(moveStage(draft, r.id, -1))} />
        <Button label={ts("moveDownAria", aria)} icon="down" iconOnly size="sm" variant="ghost" disabled={r.last} onClick={() => c.setAxis(moveStage(draft, r.id, 1))} />
        <Button label={ts("removeAria", aria)} icon="trash" iconOnly size="sm" variant="ghost" onClick={() => c.setAxis(removeStage(draft, r.id))} />
      </span>,
    ];
  };

  // The AI actions a row offers, as chips; the default stores nothing (the rule the pre-kit picker kept).
  // While the sheet has folded the cohort column, the cohort control rides here too.
  const detail = (r: MatrixRow) => {
    if (open !== r.id) return null;
    const toggle = (id: StageAiAction) => {
      const next = STAGE_AI_ACTIONS.filter((a) => (a === id ? !r.actions.current.includes(a) : r.actions.current.includes(a)));
      setActions(r.id, isDefaultStageActions(r.id, next, draft.stages) ? undefined : next);
    };
    const folded = policyCells(t, c, r.policy, display(r)).cohort;
    return (
      <span className="flex flex-wrap items-center gap-2">
        {folded ? <span className="k-show-folded"><span className="inline-block w-44">{folded}</span></span> : null}
        <ChipRow
          chips={STAGE_AI_ACTIONS.map((id) => ({
            id,
            label: tActions(id),
            pressed: r.actions.current.includes(id),
            tip: r.actions.defaults.includes(id) ? ts("actionsDefault") : undefined,
            onPress: () => toggle(id),
          }))}
        />
        {r.actions.custom ? <Button label={ts("actionsReset")} icon="resend" size="sm" variant="ghost" onClick={() => setActions(r.id, undefined)} /> : null}
      </span>
    );
  };

  return (
    <Section
      title={ts("title")}
      count={ts("meta", { count: draft.stages.length, max: AXIS_MAX_STAGES })}
      state={stored ? t("kit.savedOn", { date: fmt.date(stored) }) : t("kit.neverSaved")}
      stateMark={stored ? undefined : <Mark kind="unknown" />}
      tone={c.problems.length > 0 ? "critical" : "default"}
      actions={
        draft.stages.length < AXIS_MAX_STAGES ? (
          <Button label={ts("addStep")} icon="plus" size="sm" onClick={() => c.setAxis(addStage(draft, ts("newStepLabel"), "custom"))} />
        ) : null
      }
    >
      <FlowTable
        rows={rows}
        columns={columns}
        cells={cells}
        rowKey={(r) => r.id}
        rowState={(r) => [...(r.dirty ? (["changed"] as const) : []), ...(r.invalid ? (["error"] as const) : [])]}
        detail={detail}
        metaSplit="minmax(0,1fr) 168px"
        nameTrack="minmax(0, 22%)"
        label={ts("title")}
        emptyText={ts("problemTooFew")}
      />
      {c.problems.map((p, i) => (
        <Note key={i} tone="critical">
          {problemText(p)}
        </Note>
      ))}
    </Section>
  );
}
