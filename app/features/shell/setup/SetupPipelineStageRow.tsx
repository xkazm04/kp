"use client";

// The wizard's binding of the shared column row (features/shared/PipelineStepRow).
//
// The row's LAYOUT is shared with Settings → Hiring so the same five columns read
// the same way in both places. What lives here is only what the wizard's narrower
// contract adds, and it is all data handed to that row:
//
//  • the structural columns (entry, terminal) state their type instead of offering
//    a picker — every axis needs exactly one of each, so the wizard withholds the
//    edit rather than letting a single click invalidate the shape;
//  • a column with candidates standing on it can't be removed (the server refuses
//    it without a destination — 409 migration_required) so the button is disabled
//    with the reason on hover, and the occupancy count rides in the meta slot;
//  • labels resolve through useStageDisplayLabel, so a never-renamed shipped column
//    shows its localized name rather than its raw stored id.
import { Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { PipelineStepRow } from "@/app/features/shared/PipelineStepRow";
import { usePipelineStageRoleLabel, useStageDisplayLabel } from "@/app/features/shared/usePipelineAxisCopy";
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
  const name = displayLabel(stage);

  return (
    <PipelineStepRow
      index={index}
      label={name}
      onLabel={(value) => edit.rename(stage, value)}
      role={stage.role}
      roleOptions={SETUP_STAGE_ROLES}
      roleLabel={roleLabel}
      onRole={(role) => edit.setRole(stage, role)}
      roleFixed={fixed}
      meta={
        here > 0 ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-sm text-steel" title={t("occupiedHint", { count: here })}>
            <Users size={12} aria-hidden /> <span className="nums">{here}</span>
          </span>
        ) : null
      }
      onMove={(delta) => edit.move(stage, delta)}
      canMoveUp={edit.canMove(stage, -1)}
      canMoveDown={edit.canMove(stage, 1)}
      onRemove={fixed ? undefined : () => edit.remove(stage)}
      canRemove={edit.canRemove(stage)}
      removeTitle={here > 0 ? t("occupiedHint", { count: here }) : undefined}
      aria={{
        label: t("labelAria", { position: index + 1 }),
        role: t("roleAria", { stage: name }),
        moveUp: t("moveEarlierAria", { stage: name }),
        moveDown: t("moveLaterAria", { stage: name }),
        remove: t("removeAria", { stage: name }),
      }}
    />
  );
}
