"use client";

// Hand-off — the last onboarding step, split out of SetupOnboardingWizard.tsx so
// the wizard stays under the 200-line file cap. Reflects everything captured
// (org, language, invites, the first role's pending build) and points at the
// Getting-started checklist that takes over inside the app. Deliberately the
// QUIETEST step: plain panels, plain voice — the marketing register ended at
// Welcome.
import { ArrowRight, Check, Columns3, ListChecks, Play, Rocket } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSimulation } from "@/app/features/shell/simulation/SimulationProvider";
import { languageNative } from "@/app/features/shared/memberUi";
import { axisEqualsStored } from "@/app/features/shared/pipelineAxisDraft";
import { useStageDisplayLabel } from "@/app/features/shared/usePipelineAxisCopy";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import { EYEBROW } from "@/app/_components/ui/recipes";
import { SetupPipelineChain } from "./SetupPipelineChain";
import type { OnboardingCtrl } from "./setupSteps";

export function SetupHandoffSummary({ ctrl }: { ctrl: OnboardingCtrl }) {
  const t = useTranslations("setup.handoff");
  const sim = useSimulation();
  const displayLabel = useStageDisplayLabel();
  const { orgName, language, invites, pipeline } = ctrl.state;
  const lang = languageNative(language);
  // The board as this wizard is about to leave it, and whether that differs from
  // what the workspace already had — the summary claims a change only when
  // finish() will actually write one (setupOnboardingFinish.ts).
  const storedStages: StageDef[] = pipeline?.stored.stages.map((s) => ({ ...(s as StageDef) })) ?? [];
  const pipelineChanged = pipeline ? !axisEqualsStored(pipeline.draft, pipeline.stored, storedStages) : false;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-3 rounded-lg border border-moss/30 bg-moss/5 p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-moss/15 text-moss">
          <Check size={20} aria-hidden />
        </span>
        <div className="text-sm">
          <p className="font-semibold text-ink">{t("readyTitle", { org: orgName.trim() || t("orgFallback") })}</p>
          <p className="text-steel">
            {t("readyMeta", { language: lang, invites: invites.length })}
          </p>
        </div>
      </div>

      {/* The board, drawn as the chain it will be. Shown even when untouched: it
          is the one thing on this summary the operator will meet within seconds
          of closing the wizard, and recognising it there is the point. */}
      {pipeline ? (
        <div className="flex items-start gap-3 rounded-lg border border-stone-200 bg-white p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-coral/10 text-coral">
            <Columns3 size={18} aria-hidden />
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-ink">{t("pipelineTitle", { count: pipeline.draft.stages.length })}</p>
            <SetupPipelineChain
              stages={pipeline.draft.stages.map((s) => ({ id: s.id, label: displayLabel(s) }))}
              className="mt-1.5"
            />
            <p className="mt-1.5 max-w-[90%] text-steel">
              {pipelineChanged ? t("pipelineChangedBody") : t("pipelineDefaultBody")}
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-3 rounded-lg border border-stone-200 bg-white p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-steel/10 text-steel">
          <ListChecks size={18} aria-hidden />
        </span>
        <div className="text-sm">
          <p className="font-semibold text-ink">{t("checklistTitle")}</p>
          <p className="text-steel">{t("checklistBody")}</p>
        </div>
      </div>

      {/* The step's TWO exit paths, as equal explicit choices (the footer is
          suppressed here so nothing competes with them):
            — guided demo: finish (persist + stamp) and start the tour in one
              motion; sticker treatment marks it as the playful path.
            — explore solo: plain finish, with the pointer to WHERE the tour
              lives (the Candi button in the bottom bar) so it stays findable. */}
      <p className={`${EYEBROW} pt-2`}>{t("chooseLabel")}</p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => {
            ctrl.finish();
            sim.start();
          }}
          className="focus-ring group flex items-center gap-3 rounded-lg border-2 border-ink bg-paper p-4 text-left shadow-sticker-sm transition-all hover:-translate-y-0.5 hover:shadow-pop motion-reduce:transition-none motion-reduce:hover:translate-y-0 dark:-rotate-1 dark:hover:rotate-0"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-coral text-white shadow-sticker-xs">
            <Play size={18} aria-hidden className="translate-x-px" />
          </span>
          <span className="min-w-0 flex-1 text-sm">
            <span className="block font-semibold text-ink">{t("tourTitle")}</span>
            <span className="text-steel">{t("tourBody")}</span>
          </span>
          <ArrowRight size={16} aria-hidden className="shrink-0 text-coral transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
        </button>
        <button
          type="button"
          onClick={ctrl.finish}
          className="focus-ring group flex items-center gap-3 rounded-lg border-2 border-stone-300 bg-white p-4 text-left transition-all hover:border-ink hover:shadow-sticker-sm motion-reduce:transition-none"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-steel/10 text-steel transition-colors group-hover:bg-coral/10 group-hover:text-coral">
            <Rocket size={18} aria-hidden />
          </span>
          <span className="min-w-0 flex-1 text-sm">
            <span className="block font-semibold text-ink">{t("soloTitle")}</span>
            <span className="text-steel">{t("soloBody")}</span>
          </span>
          <ArrowRight size={16} aria-hidden className="shrink-0 text-steel transition-transform group-hover:translate-x-0.5 group-hover:text-coral motion-reduce:transition-none" />
        </button>
      </div>
    </div>
  );
}
