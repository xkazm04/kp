"use client";

/**
 * The pipeline board's empty state — "the stage set", the winner of the
 * /prototype round and now the only surface here (the switcher, the second
 * direction and their catalog keys are gone).
 *
 * METAPHOR: a set built for a play nobody has walked onto yet. The board is the
 * teaching object, so the surface IS the board: the real lanes, in the real
 * order, wearing the real column-header type (`text-meta uppercase text-steel`,
 * hairline dividers) the live PipelineBoard uses. Each lane holds a bracketed
 * exemplar of what lands in it, so reading the empty surface is reading what the
 * work will produce (docs/design/surface-doctrine.md §1: "an empty state is an
 * exemplar, not a skeleton" — the version before this one drew a row of grey
 * em-dashes, which is the skeleton that rule was written against).
 *
 * The missing half is attached WHERE IT ACTS: a hairline below the set opens the
 * inflow zone, three numbered doors that all feed the first lane, arranged left
 * to right in the order the product enforces (`pipelineEmptyMoves.ts`, pinned by
 * its test). The teaching is spatial — you can see that the role comes before
 * the candidate because it sits upstream of the lane the candidate lands in.
 *
 * NO SENTENCE OCCUPIES LAYOUT (§1). The lane strip used to carry a sentence
 * explaining that these are the lanes a candidate walks and the doors below fill
 * them; each door carried two more explaining itself. The strip and the doors
 * already say it, so all of that copy is deleted rather than shrunk, and each
 * door is now a single action card (`PipelineEmptyMoveCard.tsx`) whose whole body
 * is the control.
 *
 * STEP ZERO. The Getting-started checklist was deleted when this surface was
 * built, and it was the only door back into the first-run wizard for an operator
 * who left it early. That door lives here: `setupUnfinished` turns on ONE
 * full-width band above the set, never a fourth peer step, so the surface reads
 * whole with it and without it.
 *
 * MOTION: none of its own. Every mark here is static; the only movement is the
 * one-shot reveal each traced glyph plays on mount and the hover/focus colour
 * transitions on the cards, both gated for reduced motion (§5).
 */

import { useTranslations } from "next-intl";
import { ArrowRight, CornerLeftUp, UserPlus } from "lucide-react";
import { PANEL, EYEBROW, TITLE_DISPLAY, META_LABEL, BTN_SECONDARY } from "@/app/_components/ui/recipes";
import { useEnumLabel, labelOr } from "@/app/_lib/use-enum-label";
import { STAGES } from "@/app/features/shared/pipelineTypes";
import { EMPTY_MOVES } from "./pipelineEmptyMoves";
import { useEmptyMoveNav } from "./useEmptyMoveNav";
import { PipelineEmptyMoveCard } from "./PipelineEmptyMoveCard";

export type PipelineEmptyStateProps = {
  /** The operator left the first-run wizard early: offer to finish it as step zero. */
  setupUnfinished: boolean;
  onResumeSetup: () => void;
  /** Absent when the guided tour is already running. */
  onStartTour?: () => void;
};

/**
 * One lane of the set. The brackets are the placeholder convention and belong to
 * the COMPONENT, never to the catalog: ICU MessageFormat reads `<word>` as a tag,
 * so a translator who kept them would break the message.
 */
function SetLane({ label, slot, entry }: { label: string; slot: string; entry: boolean }) {
  return (
    <li className="min-w-0 flex-1 border-r border-stone-200 px-3 py-3 text-center last:border-r-0">
      <p className={`truncate ${META_LABEL}`}>{label}</p>
      <p className={`mt-1.5 truncate text-sm ${entry ? "font-medium text-coral" : "text-stone-400"}`}>
        {entry ? <UserPlus size={13} className="mr-1 inline align-[-2px]" aria-hidden /> : null}
        {"<"}
        {slot}
        {">"}
      </p>
    </li>
  );
}

export function PipelineEmptyState({
  setupUnfinished,
  onResumeSetup,
  onStartTour,
}: PipelineEmptyStateProps): React.JSX.Element {
  const t = useTranslations("pipeline.emptyState");
  const enumLabel = useEnumLabel();
  const go = useEmptyMoveNav();
  // The slot copy is OPTIONAL per stage: a workspace that renames or invents a
  // column (Settings -> Hiring composes the axis) simply gets no exemplar rather
  // than an English one baked in.
  const slotFor = (stage: string): string => labelOr(t, `stageSlot.${stage}`, t("stageSlotFallback"));

  return (
    <section className={`${PANEL} overflow-hidden`} aria-label={t("stageSet.title")}>
      {/* Step zero, when the wizard was left early: one full-width band, so the
          surface below is unchanged whether it is here or not. */}
      {setupUnfinished ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-amber-300 bg-amber-50 px-5 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-amber-900">{t("setupTitle")}</p>
            <p className="mt-0.5 text-sm text-amber-900">{t("setupBody")}</p>
          </div>
          <button type="button" onClick={onResumeSetup} className={`${BTN_SECONDARY} h-8 shrink-0 bg-white px-3 text-sm`}>
            {t("setupResume")} <ArrowRight size={13} aria-hidden />
          </button>
        </div>
      ) : null}

      <div className="px-5 pt-5">
        <p className={EYEBROW}>{t("stageSet.eyebrow")}</p>
        <h2 className={`mt-1 ${TITLE_DISPLAY}`}>{t("stageSet.title")}</h2>
      </div>

      {/* The set itself: the live board's column header row, unfilled. */}
      <ol aria-label={t("stageSet.laneStrip")} className="mt-4 flex border-y border-stone-200 bg-stone-50">
        {STAGES.map((stage, i) => (
          <SetLane key={stage} label={enumLabel("stage", stage)} slot={slotFor(stage)} entry={i === 0} />
        ))}
      </ol>

      {/* The inflow zone: everything that fills the lane above it, in order. */}
      <p id="pipeline-empty-inflow" className={`flex items-center gap-1.5 px-5 pb-1 pt-4 ${META_LABEL}`}>
        <CornerLeftUp size={13} aria-hidden />
        {t("stageSet.inflow")}
      </p>
      {/* Named by the visible line above rather than by a duplicate `aria-label`,
          so the label is not read twice. */}
      <ol
        aria-labelledby="pipeline-empty-inflow"
        className="flex flex-col divide-y divide-stone-200 sm:flex-row sm:divide-y-0"
      >
        {EMPTY_MOVES.map((move, i) => (
          <PipelineEmptyMoveCard
            key={move.key}
            index={i}
            moveKey={move.key}
            title={t(`moves.${move.key}.title`)}
            optional={move.optional}
            optionalLabel={t("optional")}
            onOpen={() => go(move.tab)}
          />
        ))}
      </ol>

      {onStartTour ? (
        <div className="border-t border-stone-200 px-5 py-3">
          <button
            type="button"
            onClick={onStartTour}
            className="focus-ring rounded text-sm font-semibold text-coral hover:underline"
          >
            {t("tour")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
