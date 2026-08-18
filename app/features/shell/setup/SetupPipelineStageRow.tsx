"use client";

// One editable column, as a ROW — the fine-tune line under the preset tiles.
//
// Extracted from the presets variant so the vertical editor is reusable on its
// own (a settings-style list is the shape most surfaces would want) and so the
// variant file stays readable. Same guarded edit contract as everything else in
// this step: the structural columns show what they are instead of offering an
// edit that would invalidate the axis, and an occupied column can't be removed.
import { ArrowDown, ArrowUp, Users, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Select } from "@/app/_components/Select";
import { TextInput } from "@/app/_components/TextInput";
import { BTN_SECONDARY, CHIP_QUIET } from "@/app/_components/ui/recipes";
import { usePipelineStageRoleLabel, useStageDisplayLabel } from "@/app/features/shared/usePipelineAxisCopy";
import type { PipelineStageRoleWire } from "@/app/_lib/decision-config-schema";
import type { DraftStage } from "@/app/features/shared/pipelineAxisDraft";
import { SETUP_STAGE_ROLES, type SetupPipelineEdit } from "./setupPipelineEdit";

export function SetupPipelineStageRow({
  edit,
  stage,
  index,
}: {
  edit: SetupPipelineEdit;
  stage: DraftStage;
  index: number;
}) {
  const t = useTranslations("setup.pipeline");
  const roleLabel = usePipelineStageRoleLabel();
  const displayLabel = useStageDisplayLabel();
  const fixed = edit.isFixed(stage);
  const here = edit.occupants(stage);

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-stone-200 bg-paper/50 px-2.5 py-2">
      <span className="nums w-5 shrink-0 text-sm text-stone-400">{index + 1}.</span>

      <TextInput
        type="text"
        value={displayLabel(stage)}
        onChange={(e) => edit.rename(stage, e.target.value)}
        aria-label={t("labelAria", { position: index + 1 })}
        sizeVariant="sm"
        className="min-w-40 flex-1"
      />

      {fixed ? (
        <span className={`${CHIP_QUIET} shrink-0 font-semibold text-moss`}>{roleLabel(stage.role)}</span>
      ) : (
        <Select
          value={stage.role}
          onChange={(role) => edit.setRole(stage, role as PipelineStageRoleWire)}
          ariaLabel={t("roleAria", { stage: displayLabel(stage) })}
          sizeVariant="sm"
          options={SETUP_STAGE_ROLES.map((role) => ({ value: role, label: roleLabel(role) }))}
        />
      )}

      {here > 0 ? (
        <span className="inline-flex shrink-0 items-center gap-1 text-sm text-steel" title={t("occupiedHint", { count: here })}>
          <Users size={12} aria-hidden /> <span className="nums">{here}</span>
        </span>
      ) : null}

      <span className="ml-auto flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => edit.move(stage, -1)}
          disabled={!edit.canMove(stage, -1)}
          aria-label={t("moveEarlierAria", { stage: displayLabel(stage) })}
          className={`${BTN_SECONDARY} h-7 w-7 justify-center p-0`}
        >
          <ArrowUp size={13} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => edit.move(stage, 1)}
          disabled={!edit.canMove(stage, 1)}
          aria-label={t("moveLaterAria", { stage: displayLabel(stage) })}
          className={`${BTN_SECONDARY} h-7 w-7 justify-center p-0`}
        >
          <ArrowDown size={13} aria-hidden />
        </button>
        {/* A structural column gets NO remove control at all (the board variant
            does the same): every axis needs exactly one entry and one terminal, so
            a permanently disabled button would only be furniture. An OCCUPIED
            column keeps the disabled button — there the reason is real, temporary
            and worth saying, which the tooltip does. */}
        {fixed ? null : (
          <button
            type="button"
            onClick={() => edit.remove(stage)}
            disabled={!edit.canRemove(stage)}
            title={here > 0 ? t("occupiedHint", { count: here }) : undefined}
            aria-label={t("removeAria", { stage: displayLabel(stage) })}
            className="focus-ring rounded-md p-1 text-steel transition-colors hover:text-coral disabled:opacity-40 disabled:hover:text-steel"
          >
            <X size={14} aria-hidden />
          </button>
        )}
      </span>
    </li>
  );
}
