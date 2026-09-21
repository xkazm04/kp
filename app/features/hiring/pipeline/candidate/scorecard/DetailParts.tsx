"use client";

// Shared building blocks of the Scorecard: the stage route (the candidate's line on
// the subway map), the skills evidence and the analysis note.

import { useTranslations } from "next-intl";
import { META_LABEL } from "@/app/_components/ui/recipes";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import type { CandidateDetailModel } from "./candidateDetailModel";

const NS = "pipeline.candidate.scorecard";

/** The axis as a line of stations — passed ones ringed coral, the current one
 *  filled, the ones ahead hollow. The text of each station is its label. */
export function StageRoute({
  axis,
  current,
  stageLabel,
}: {
  axis: readonly StageDef[];
  current: string;
  stageLabel: (stage: StageDef) => string;
}) {
  const t = useTranslations(NS);
  const at = axis.findIndex((s) => s.id === current);
  return (
    <ol className="flex w-full items-start" aria-label={t("route")}>
      {axis.map((s, i) => {
        const here = i === at;
        const passed = at >= 0 && i < at;
        return (
          <li
            key={s.id}
            aria-current={here ? "step" : undefined}
            className="relative flex min-w-0 flex-1 flex-col items-center gap-1.5"
          >
            {i > 0 ? (
              <span
                aria-hidden="true"
                className={`absolute right-1/2 top-[7px] h-0.5 w-full ${at >= 0 && i <= at ? "bg-coral" : "bg-stone-200"}`}
              />
            ) : null}
            <span
              aria-hidden="true"
              className={`relative z-10 block rounded-full border-2 ${
                here
                  ? "h-4 w-4 border-coral bg-coral"
                  : passed
                    ? "mt-0.5 h-3 w-3 border-coral bg-white"
                    : "mt-0.5 h-3 w-3 border-stone-300 bg-white"
              }`}
            />
            <span className={`w-full truncate px-1 text-center text-xs ${here ? "font-semibold text-ink" : "text-steel"}`}>
              {stageLabel(s)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const SKILL_GROUPS = [
  { key: "matched", tone: "bg-green-50 text-green-700" },
  { key: "unproven", tone: "bg-amber-50 text-amber-800" },
  { key: "missing", tone: "bg-red-50 text-red-700" },
] as const;

export function SkillGroups({ model, layout = "stack" }: { model: CandidateDetailModel; layout?: "stack" | "columns" }) {
  const t = useTranslations(NS);
  const groups = SKILL_GROUPS.filter((g) => model[g.key].length > 0);
  if (groups.length === 0) {
    return model.hasAnalysis ? <p className="text-sm text-steel">{t("noSkills")}</p> : null;
  }
  return (
    <div className={layout === "columns" ? "grid gap-5 sm:grid-cols-3" : "space-y-4"}>
      {groups.map((g) => (
        <section key={g.key}>
          <h3 className={`${META_LABEL} flex items-baseline gap-1.5`}>
            {t(g.key)} <span className="nums">{model[g.key].length}</span>
          </h3>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {model[g.key].map((s) => (
              <li key={s} className={`rounded px-1.5 py-0.5 text-sm ${g.tone}`}>
                {s}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Why the breakdown is missing, when it is — loading, a failed ranking, or simply
 *  no analysis for this role. Silent when the breakdown is on screen. */
export function AnalysisNote({
  model,
  loading,
  error,
}: {
  model: CandidateDetailModel;
  loading: boolean;
  error: string | null;
}) {
  const t = useTranslations(NS);
  if (model.hasAnalysis) return null;
  return <p className="text-sm text-steel">{t(loading ? "loading" : error ? "matchError" : "noAnalysis")}</p>;
}
