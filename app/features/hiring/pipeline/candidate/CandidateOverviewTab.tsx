"use client";

// Overview — the Scorecard. Anything that is the candidate's ONE pending question
// leads it: a degraded intake to capture, or, for someone this workspace hired, how
// the hire worked out. Then a summary rail (score with its kind and provenance, the
// confidence meter, fit tier, estimated salary against the band, the route across
// the axis) beside the weighted breakdown and the skills evidence. Every action on
// the candidate lives in the modal's footer (footer/CandidateFooter.tsx).

import { useTranslations } from "next-intl";
import { FitTierBadge } from "@/app/_components/Badge";
import { useScoreProvenanceText } from "@/app/_components/ScoreProvenanceLabel";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { stageHasRole, type StageDef } from "@/app/_lib/pipeline-stages";
import { useFitTierLabels } from "@/app/features/shared/MatchPresentation";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import { useMapMoney } from "../map/useMapMoney";
import { PipelineDegradedIntakeBanner } from "../PipelineDegradedIntakeBanner";
import { PipelineHireOutcomeCard } from "../PipelineHireOutcomeCard";
import type { CandidateState } from "./state/useCandidateState";
import type { CandidateDetailModel } from "./scorecard/candidateDetailModel";
import { AnalysisNote, SkillGroups, StageRoute } from "./scorecard/DetailParts";
import { BreakdownTable, ScoreFigure, ScoreMeter } from "./scorecard/DetailScoreParts";

export function CandidateOverviewTab({
  entry,
  axis,
  model,
  stageLabel,
  matchLoading,
  matchError,
  st,
}: {
  entry: Entry;
  axis: readonly StageDef[];
  model: CandidateDetailModel;
  stageLabel: (stage: StageDef) => string;
  matchLoading: boolean;
  matchError: string | null;
  st: CandidateState;
}) {
  const tDrawer = useTranslations("pipeline.drawer");
  const t = useTranslations("pipeline.candidate.scorecard");
  const provenanceText = useScoreProvenanceText();
  const tierLabels = useFitTierLabels();
  const money = useMapMoney();
  const hired = stageHasRole(entry.stage, "terminal", axis);
  // The ranking's fresh total is a match score; without it the board's own number
  // speaks, and a work-sample TRANSFER score must never read as a match score.
  const board = model.hasAnalysis ? null : model.display;
  const caption = board?.kind === "transfer" ? tDrawer("transfer") : t("score");
  const fit = model.salary.fit;
  const fitNote = fit === "unknown" ? null : t(`salaryFit.${fit}`);

  return (
    <div className="flex flex-col">
      {entry.intakeDegraded || hired ? (
        <div className="space-y-4 px-4 pt-5 sm:px-6">
          {entry.intakeDegraded ? (
            <PipelineDegradedIntakeBanner
              reason={entry.intakeDegradedReason}
              resolving={st.resolvingIntake}
              intakeErr={st.intakeErr}
              onResolve={st.resolveIntake}
            />
          ) : null}
          {hired ? <PipelineHireOutcomeCard entryId={entry.id} /> : null}
        </div>
      ) : null}

      <div className="mt-5 grid border-t border-stone-200 bg-white md:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="flex flex-col gap-5 border-b border-stone-200 p-6 md:border-b-0 md:border-r">
          <div className="flex items-end justify-between gap-3">
            <ScoreFigure
              model={model}
              size="xl"
              caption={caption}
              detail={board ? provenanceText(board.provenance) : null}
            />
            <FitTierBadge tier={model.fitTier} score={model.raw} labels={tierLabels} />
          </div>
          <ScoreMeter model={model} />
          <div>
            <p className={META_LABEL}>{t("salary")}</p>
            <p className="nums mt-1 text-lg font-semibold text-ink">~{money.point(model.salary.midpoint)}</p>
            <p className="mt-0.5 text-sm text-steel">{fitNote ? `${t("estimate")} · ${fitNote}` : t("estimate")}</p>
          </div>
          <div>
            <p className={`${META_LABEL} mb-3`}>{t("route")}</p>
            <StageRoute axis={axis} current={entry.stage} stageLabel={stageLabel} />
          </div>
        </aside>

        <div className="min-w-0 space-y-6 p-6">
          <div className="space-y-2">
            <BreakdownTable model={model} loading={matchLoading && !model.hasAnalysis} />
            <AnalysisNote model={model} loading={matchLoading} error={matchError} />
          </div>
          <SkillGroups model={model} layout="columns" />
        </div>
      </div>
    </div>
  );
}
