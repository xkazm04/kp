"use client";

import { useTranslations } from "next-intl";
import { Button, Mark, Note, Section, SelectField, SettingRow, TextField } from "@/app/_components/kit";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import {
  addStage,
  ASSIGNABLE_ROLES,
  AXIS_MAX_STAGES,
  moveStage,
  removeStage,
  renameStage,
  setStageRole,
} from "@/app/features/shared/pipelineAxisDraft";
import {
  usePipelineAxisProblemText,
  usePipelineStageRoleLabel,
  usePipelineStageRoleMeaning,
} from "@/app/features/shared/usePipelineAxisCopy";
import { stepRows, type Composer } from "./hiringKitModel";

/**
 * The board's columns, one setting row each: the name IS the field (rename in place, weight 600),
 * the type is the control, what the type means is the consequence, and reorder / remove sit in
 * the act track. Every edit goes through pipelineAxisDraft, the rules the current table and the
 * first-run wizard share; the problems it names are listed under the rows, never summarised.
 */
export function HiringKitSteps({ c }: { c: Composer }) {
  const t = useTranslations("hiringPlan");
  const ts = useTranslations("hiringPlan.steps");
  const fmt = useDateFormat();
  const roleLabel = usePipelineStageRoleLabel();
  const roleMeaning = usePipelineStageRoleMeaning();
  const problemText = usePipelineAxisProblemText();
  const draft = c.axis;
  if (!draft) return null;
  const rows = stepRows(draft, c.savedStages, c.counts, c.countsLoaded);
  const stored = c.versions.pipelineStages ?? null;
  const roleOptions = ASSIGNABLE_ROLES.map((r) => ({ value: r, label: roleLabel(r) }));

  return (
    <Section
      title={ts("title")}
      count={ts("meta", { count: draft.stages.length, max: AXIS_MAX_STAGES })}
      state={stored ? t("kit.savedOn", { date: fmt.date(stored) }) : t("kit.neverSaved")}
      stateMark={stored ? undefined : <Mark kind="unknown" />}
      tone={c.problems.length > 0 ? "critical" : "default"}
      actions={
        draft.stages.length < AXIS_MAX_STAGES ? (
          <Button
            label={ts("addStep")}
            icon="plus"
            size="sm"
            onClick={() => c.setAxis(addStage(draft, ts("newStepLabel"), "custom"))}
          />
        ) : null
      }
    >
      {rows.map((r, i) => {
        const aria = { stage: r.label || r.id };
        const where = !r.saved ? ts("new") : r.count == null ? null : t("impact.occupancy", { count: r.count });
        return (
          <SettingRow
            key={r.id}
            mark={r.invalid ? <Mark kind="caution" tip={ts(r.label.trim() ? "problemDuplicateLabel" : "problemEmptyLabel", { label: r.label.trim() })} /> : null}
            name={
              <TextField
                size="sm"
                label={ts("labelAria", { position: i + 1 })}
                value={r.label}
                invalid={r.invalid}
                // The stored key never moves on a rename; a draft-only step has none yet.
                tip={r.saved ? `${ts("idTitle")} (${r.id})` : ts("new")}
                onChange={(v) => c.setAxis(renameStage(draft, r.id, v))}
              />
            }
            sub={where ? `${roleLabel(r.role)} · ${where}` : roleLabel(r.role)}
            consequence={roleMeaning(r.role)}
            control={
              <SelectField
                size="sm"
                label={ts("roleAria", aria)}
                value={r.role}
                options={roleOptions}
                onChange={(role) => c.setAxis(setStageRole(draft, r.id, role as (typeof ASSIGNABLE_ROLES)[number]))}
              />
            }
            actions={
              <>
                <Button label={ts("moveUpAria", aria)} icon="up" iconOnly size="sm" variant="ghost" disabled={r.first} onClick={() => c.setAxis(moveStage(draft, r.id, -1))} />
                <Button label={ts("moveDownAria", aria)} icon="down" iconOnly size="sm" variant="ghost" disabled={r.last} onClick={() => c.setAxis(moveStage(draft, r.id, 1))} />
                <Button label={ts("removeAria", aria)} icon="trash" iconOnly size="sm" variant="ghost" onClick={() => c.setAxis(removeStage(draft, r.id))} />
              </>
            }
            state={[...(r.changed ? (["changed"] as const) : []), ...(r.invalid ? (["error"] as const) : [])]}
          />
        );
      })}
      {/* Why this draft cannot be saved: each reason on its own line, the reader fixes each one. */}
      {c.problems.map((p, i) => (
        <Note key={i} tone="critical">
          {problemText(p)}
        </Note>
      ))}
    </Section>
  );
}
