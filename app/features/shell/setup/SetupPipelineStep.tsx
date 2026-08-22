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
// VIEW FIRST, EDIT ON DEMAND. The step opens read-only: a picture of the hiring
// process the workspace already has, in words a reader who has never used an ATS
// can follow. That is the honest default, because the shipped axis fits most teams
// and the previous design asked every operator to audit five rename fields before
// they knew what a "stage role" was. Editing is one button away and lands in the
// preset-then-fine-tune surface (SetupPipelinePresetsVariant): a shape to start
// from, then the knobs.
//
// The read-only half is the JOURNEY (SetupPipelineJourneyView): a vertical walk
// down the funnel where every stop says, in one plain line, what happens there. It
// beat a columns-preview variant in the /prototype round — a first-run reader does
// not yet recognise the board, so explaining the process is worth more than
// rehearsing a screen they have never seen. The preview lives on where it is
// actually useful: the hand-off summary's chain.
//
// Nothing here writes. The draft rides in the wizard's state and is persisted by
// finish() — and only when it actually differs from what the workspace already
// had (setupOnboardingFinish.ts).

import { useState } from "react";
import { AlertTriangle, Check, SquarePen } from "lucide-react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/app/_components/Skeleton";
import { BTN_SECONDARY } from "@/app/_components/ui/recipes";
import { axisEqualsStored } from "@/app/features/shared/pipelineAxisDraft";
import { usePipelineAxisProblemText } from "@/app/features/shared/usePipelineAxisCopy";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import { useSetupPipelineEdit } from "./setupPipelineEdit";
import { SetupPipelineJourneyView } from "./SetupPipelineJourneyView";
import { SetupPipelinePresetsVariant } from "./SetupPipelinePresetsVariant";
import type { OnboardingCtrl, SetupPipeline } from "./setupSteps";

export function SetupPipelineStep({ ctrl }: { ctrl: OnboardingCtrl }) {
  const t = useTranslations("setup.pipeline");
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

  return <SetupPipelineEditor ctrl={ctrl} pipeline={pipeline} />;
}

/** Split from the guard above so the edit hook only ever runs with a loaded axis
 *  (a hook cannot live behind an early return). */
function SetupPipelineEditor({ ctrl, pipeline }: { ctrl: OnboardingCtrl; pipeline: SetupPipeline }) {
  const t = useTranslations("setup.pipeline");
  const edit = useSetupPipelineEdit(ctrl, pipeline);
  const problemText = usePipelineAxisProblemText();
  const [editing, setEditing] = useState(false);
  const savedStages: StageDef[] = edit.pipeline.stored.stages.map((s) => ({ ...(s as StageDef) }));
  const dirty = !axisEqualsStored(edit.draft, edit.pipeline.stored, savedStages);

  return (
    <div className="space-y-4">
      {/* Just the mode switch. There is no section heading here and no step count:
          the card already opens with an eyebrow, a title and a blurb naming this
          step, so a second header under them restated what the reader had just
          read — and restated it in the uppercase-tracked `text-meta` label, which
          is a form-section marker, not prose. Deleted rather than re-cased: the
          fix for a line that says nothing is not a quieter typeface. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setEditing((on) => !on)}
          // Leaving edit mode is blocked while the draft is unsaveable: the view has
          // no affordance to fix a duplicate name, so "Done" would hide the problem
          // behind a picture that cannot be persisted.
          disabled={editing && edit.problems.length > 0}
          className={`${BTN_SECONDARY} h-9 gap-1.5 px-3 text-sm font-semibold`}
        >
          {editing ? (
            <>
              <Check size={14} className="text-moss" aria-hidden /> {t("viewCta")}
            </>
          ) : (
            <>
              <SquarePen size={14} className="text-coral" aria-hidden /> {t("editCta")}
            </>
          )}
        </button>
      </div>

      {editing ? <SetupPipelinePresetsVariant edit={edit} /> : <SetupPipelineJourneyView edit={edit} />}

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
