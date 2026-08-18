"use client";

// Pipeline step — the board's columns, decided once at first run.
//
// This is what step 4 asks now. It used to ask for a first job description; that
// belongs in the Library, where a build has a ledger, a retry and honest engine
// caveats, and the Getting-started checklist walks the operator there
// (setupGettingStartedModel.ts). The board's shape, by contrast, is a decision
// every later screen depends on, is cheap to make while nothing is on the board,
// and is asked nowhere else at first run.
//
// PROTOTYPE SCAFFOLD (/prototype phase 2): two directional variants sit behind
// the switcher below — "board" (the funnel drawn as columns) and "presets" (three
// named shapes, then the knobs). Both edit the SAME draft through the same
// guarded contract, so switching never loses work. Once a direction wins, drop
// the switcher and the loser.
//
// Nothing here writes. The draft rides in the wizard's state and is persisted by
// finish() — and only when it actually differs from what the workspace already
// had (setupOnboardingFinish.ts).

import { useState } from "react";
import { AlertTriangle, Columns3, LayoutList } from "lucide-react";
import { useTranslations } from "next-intl";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { Skeleton } from "@/app/_components/Skeleton";
import { axisEqualsStored } from "@/app/features/shared/pipelineAxisDraft";
import { usePipelineAxisProblemText } from "@/app/features/shared/usePipelineAxisCopy";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import { useSetupPipelineEdit } from "./setupPipelineEdit";
import { SetupPipelineBoardVariant } from "./SetupPipelineBoardVariant";
import { SetupPipelinePresetsVariant } from "./SetupPipelinePresetsVariant";
import type { OnboardingCtrl, SetupPipeline } from "./setupSteps";

type PipelineVariant = "board" | "presets";

export function SetupPipelineStep({ ctrl }: { ctrl: OnboardingCtrl }) {
  const t = useTranslations("setup.pipeline");
  const [variant, setVariant] = useState<PipelineVariant>("board");
  const { pipeline, pipelineLoad } = ctrl.state;

  // Not a spinner that can never end: a failed read says so and Continue stays
  // open (stepSatisfied), because the workspace keeps whatever board it has.
  if (pipelineLoad === "failed") {
    return (
      <p role="alert" className="flex max-w-[90%] items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0" />
        {t("loadFailed")}
      </p>
    );
  }

  if (!pipeline) {
    // The shape of what's coming rather than a shimmer bar: four column cards.
    return (
      <div>
        <span className="sr-only" role="status">
          {t("loading")}
        </span>
        <div className="flex gap-1.5" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-40" />
          ))}
        </div>
      </div>
    );
  }

  return <SetupPipelineEditor ctrl={ctrl} pipeline={pipeline} variant={variant} onVariant={setVariant} />;
}

/** Split from the guard above so the edit hook only ever runs with a loaded axis
 *  (a hook cannot live behind an early return). */
function SetupPipelineEditor({
  ctrl,
  pipeline,
  variant,
  onVariant,
}: {
  ctrl: OnboardingCtrl;
  pipeline: SetupPipeline;
  variant: PipelineVariant;
  onVariant: (v: PipelineVariant) => void;
}) {
  const t = useTranslations("setup.pipeline");
  const edit = useSetupPipelineEdit(ctrl, pipeline);
  const problemText = usePipelineAxisProblemText();
  const savedStages: StageDef[] = edit.pipeline.stored.stages.map((s) => ({ ...(s as StageDef) }));
  const dirty = !axisEqualsStored(edit.draft, edit.pipeline.stored, savedStages);

  return (
    <div className="space-y-4">
      <SegmentedControl<PipelineVariant>
        label={t("variantLabel")}
        value={variant}
        onChange={onVariant}
        options={[
          {
            value: "board",
            label: (
              <span className="inline-flex items-center gap-1.5">
                <Columns3 size={14} aria-hidden /> {t("variant.board")}
              </span>
            ),
          },
          {
            value: "presets",
            label: (
              <span className="inline-flex items-center gap-1.5">
                <LayoutList size={14} aria-hidden /> {t("variant.presets")}
              </span>
            ),
          },
        ]}
      />

      {variant === "board" ? (
        <SetupPipelineBoardVariant edit={edit} />
      ) : (
        <SetupPipelinePresetsVariant edit={edit} />
      )}

      {/* Why this draft can't go forward, listed rather than summarised — the same
          sentences the Settings composer uses (usePipelineAxisCopy.ts). Continue
          is gated on this being empty (stepSatisfied). */}
      {edit.problems.length > 0 ? (
        <ul role="alert" className="space-y-1 rounded-md border border-coral/40 bg-coral/5 px-3 py-2 text-sm text-coral">
          {edit.problems.map((p, i) => (
            <li key={i}>{problemText(p)}</li>
          ))}
        </ul>
      ) : null}

      {/* The wizard persists at finish, not per keystroke. Say so the moment the
          draft stops matching the workspace's board, and say where this lives
          afterwards — a first-run decision must not feel permanent. */}
      <p className="max-w-[90%] text-sm text-steel">{dirty ? t("dirtyNote") : t("laterNote")}</p>
    </div>
  );
}
