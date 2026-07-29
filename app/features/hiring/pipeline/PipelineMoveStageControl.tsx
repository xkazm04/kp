"use client";

// The drawer's manual stage-override select: move a candidate backward / skip /
// correct a miscategorization — the transitions the AI accept/reject can't
// express. Split out of PipelineCandidateDrawer.tsx.

import { ArrowLeftRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Select } from "@/app/_components/Select";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { moveStageSelectValues } from "./pipelineMoveTargets";

export function PipelineMoveStageControl({
  stage,
  movingStage,
  moveErr,
  onMoveStage,
}: {
  stage: string;
  movingStage: boolean;
  moveErr: string | null;
  onMoveStage: (toStage: string) => void;
}) {
  const t = useTranslations("pipeline.drawer");
  const enumLabel = useEnumLabel();
  return (
    <div>
      <label htmlFor="move-stage" className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
        <ArrowLeftRight size={13} /> {t("moveStage")}
      </label>
      <p className="mt-1 text-sm text-steel">{t("moveStageHelp")}</p>
      <Select
        id="move-stage"
        ariaLabel={t("moveStage")}
        value={stage}
        disabled={movingStage}
        onChange={onMoveStage}
        size="sm"
        className="mt-2 w-full"
        options={moveStageSelectValues(stage).map((s) => ({
          value: s,
          label: `${enumLabel("stage", s)}${s === stage ? t("current") : ""}`,
        }))}
      />
      {moveErr ? <p role="alert" className="mt-1.5 text-sm text-red-700">{moveErr}</p> : null}
    </div>
  );
}
