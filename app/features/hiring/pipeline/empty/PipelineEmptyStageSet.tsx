"use client";

/**
 * Variant A — "the stage set".
 *
 * METAPHOR: a set built for a play nobody has walked onto yet. The board is the
 * teaching object, so the surface IS the board: the real lanes, in the real order,
 * wearing the real column-header type (`text-meta uppercase text-steel`, hairline
 * dividers) the live PipelineBoard uses. Each lane holds a bracketed exemplar of
 * what lands in it, so reading the empty surface is reading what the work will
 * produce (docs/design/surface-doctrine.md §1: "an empty state is an exemplar,
 * not a skeleton" — the previous version's row of grey em-dashes was the skeleton
 * that rule was written against).
 *
 * The missing half the owner asked for is attached WHERE IT ACTS: a hairline
 * below the set opens the inflow zone, three numbered doors that all feed the
 * first lane, arranged left to right in the order the product enforces. The
 * teaching is spatial — you can see that the role comes before the candidate
 * because it sits upstream of the lane the candidate lands in.
 *
 * AGAINST VARIANT B: no step is promoted and no glyph is drawn. The funnel is the
 * illustration and all three moves are legible at once; B ranks them and hides
 * two behind ticks. Pick this one if the operator's first question is "what is
 * this board", pick B if it is "what do I do".
 *
 * MOTION: none of its own. Every mark here is static; the only movement on the
 * surface is the switcher's crossfade (§5: motion belongs to state changes).
 */

import { useTranslations } from "next-intl";
import { ArrowRight, CornerLeftUp, UserPlus } from "lucide-react";
import { PANEL, EYEBROW, TITLE_DISPLAY, INTRO, META_LABEL, BTN_PRIMARY, BTN_SECONDARY, CHIP_QUIET } from "@/app/_components/ui/recipes";
import { useEnumLabel, labelOr } from "@/app/_lib/use-enum-label";
import { STAGES } from "@/app/features/shared/pipelineTypes";
import { EMPTY_MOVES } from "./pipelineEmptyMoves";
import { useEmptyMoveNav } from "./useEmptyMoveNav";
import type { PipelineEmptyStateProps } from "./PipelineEmptyState";

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

/** One door into the first lane: its rank, what it is, and the tab it happens on. */
function SetDoor({
  index,
  title,
  body,
  action,
  optional,
  optionalLabel,
  onOpen,
}: {
  index: number;
  title: string;
  body: string;
  action: string;
  optional: boolean;
  optionalLabel: string;
  onOpen: () => void;
}) {
  return (
    <li className="min-w-0 flex-1 border-stone-200 px-5 py-4 sm:border-r sm:last:border-r-0">
      <div className="flex items-baseline gap-2">
        <span className="font-serif text-h2 leading-none nums text-stone-400">{index + 1}</span>
        <p className="min-w-0 text-base font-semibold text-ink">{title}</p>
        {optional ? <span className={`${CHIP_QUIET} shrink-0 text-meta uppercase`}>{optionalLabel}</span> : null}
      </div>
      <p className="mt-1.5 text-sm text-steel">{body}</p>
      <button
        type="button"
        onClick={onOpen}
        className={`mt-3 ${index === 0 ? BTN_PRIMARY : BTN_SECONDARY} h-8 px-3 text-sm`}
      >
        {action} <ArrowRight size={13} aria-hidden />
      </button>
    </li>
  );
}

export function PipelineEmptyStageSet({ setupUnfinished, onResumeSetup, onStartTour }: PipelineEmptyStateProps) {
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
        <p className={`mt-2 max-w-3xl ${INTRO}`}>{t("stageSet.body")}</p>
      </div>

      {/* The set itself: the live board's column header row, unfilled. */}
      <ol aria-label={t("stageSet.laneStrip")} className="mt-4 flex border-y border-stone-200 bg-stone-50">
        {STAGES.map((stage, i) => (
          <SetLane key={stage} label={enumLabel("stage", stage)} slot={slotFor(stage)} entry={i === 0} />
        ))}
      </ol>

      {/* The inflow zone: everything that fills the lane above it, in order. */}
      <p className={`flex items-center gap-1.5 px-5 pb-1 pt-4 ${META_LABEL}`}>
        <CornerLeftUp size={13} aria-hidden />
        {t("stageSet.inflow")}
      </p>
      <ol className="flex flex-col divide-y divide-stone-200 sm:flex-row sm:divide-y-0">
        {EMPTY_MOVES.map((move, i) => (
          <SetDoor
            key={move.key}
            index={i}
            title={t(`moves.${move.key}.title`)}
            body={t(`moves.${move.key}.body`)}
            action={t(`moves.${move.key}.action`)}
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
