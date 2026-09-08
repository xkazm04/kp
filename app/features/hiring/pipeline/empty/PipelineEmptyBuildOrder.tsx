"use client";

/**
 * Variant B — "the build order".
 *
 * METAPHOR: a build order, the way a recipe or an assembly sheet reads. An empty
 * board is not a thing to study, it is a thing to fill, and three simultaneous
 * chores give an operator three ways to be wrong. So the surface applies
 * docs/design/surface-doctrine.md §6, the live thing is the hero: ONE move stands
 * at reading size with its drawn subject, its one sentence and its one button,
 * and the other two compress to numbered ticks. Nothing is hidden; the ticks are
 * the picker, so re-aiming the sheet is a click.
 *
 * The funnel the previous empty state made its hero survives here, demoted to a
 * single quiet line under the rule: the real localized stage names in the real
 * order, as the answer to "and then what". It is a caption, not a diagram, which
 * is the whole difference from variant A.
 *
 * AGAINST VARIANT A: A shows all three moves at equal weight around a full-size
 * board; B ranks them and shows one. A answers "what am I looking at" first, B
 * answers "what do I do first" first.
 *
 * MOTION: only on the state change (§5). Re-aiming the sheet crossfades the hero
 * and the ink pill glides between ticks on a shared `layoutId`, the app's
 * segmented-control motion standard (AnalyzeWorkspace.tsx); both drop to their
 * end state under `prefers-reduced-motion`. Nothing loops, nothing drifts.
 */

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { ArrowRight, ChevronRight, Settings2 } from "lucide-react";
import {
  PANEL,
  EYEBROW,
  TITLE_DISPLAY,
  META_LABEL,
  BTN_PRIMARY,
  BTN_GHOST,
  CHIP_QUIET,
  DIVIDER,
} from "@/app/_components/ui/recipes";
import { MotionizedGlyph } from "@/app/_components/glyph/MotionizedGlyph";
import { GLYPH_SIZE } from "@/app/_components/glyph/glyphSizes";
import type { TracedGlyph } from "@/app/_components/glyph/MotionizedGlyph";
import { STEP_FIRST_ROLE_GLYPH } from "@/app/_components/glyph/glyphs/stepFirstRoleGlyph";
import { PROFILE_ROSTER_GLYPH } from "@/app/_components/glyph/glyphs/profileRosterGlyph";
import { STEP_CHANNELS_GLYPH } from "@/app/_components/glyph/glyphs/stepChannelsGlyph";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { STAGES } from "@/app/features/shared/pipelineTypes";
import { EMPTY_MOVES, FIRST_MOVE, type EmptyMoveKey } from "./pipelineEmptyMoves";
import { useEmptyMoveNav } from "./useEmptyMoveNav";
import type { PipelineEmptyStateProps } from "./PipelineEmptyState";

// The drawn subject per move. A map, never a component factory called during
// render, and deliberately variant-local: only this direction draws one, because
// variant A's illustration is the board itself.
const MOVE_GLYPH: Record<EmptyMoveKey, TracedGlyph> = {
  role: STEP_FIRST_ROLE_GLYPH,
  candidates: PROFILE_ROSTER_GLYPH,
  channels: STEP_CHANNELS_GLYPH,
};

function OrderTick({
  index,
  label,
  active,
  reduced,
  onSelect,
}: {
  index: number;
  label: string;
  active: boolean;
  reduced: boolean;
  onSelect: () => void;
}) {
  return (
    <li className="min-w-0 flex-1">
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "step" : undefined}
        className="focus-ring relative flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors"
      >
        {active ? (
          <motion.span
            layoutId="pipeline-empty-order"
            aria-hidden
            className="absolute inset-0 rounded-md bg-ink dark:rounded-lg"
            transition={reduced ? { duration: 0 } : { type: "spring", bounce: 0.2, duration: 0.35 }}
          />
        ) : null}
        <span className={`relative font-serif text-body leading-none nums ${active ? "text-white" : "text-stone-400"}`}>
          {index + 1}
        </span>
        <span className={`relative min-w-0 truncate text-sm font-medium ${active ? "text-white" : "text-steel"}`}>
          {label}
        </span>
      </button>
    </li>
  );
}

export function PipelineEmptyBuildOrder({ setupUnfinished, onResumeSetup, onStartTour }: PipelineEmptyStateProps) {
  const t = useTranslations("pipeline.emptyState");
  const enumLabel = useEnumLabel();
  const reduced = useReducedMotion();
  const go = useEmptyMoveNav();
  // The product picks the honest first move; the operator may re-aim the sheet.
  const [picked, setPicked] = useState<EmptyMoveKey | null>(null);
  const index = Math.max(
    0,
    EMPTY_MOVES.findIndex((m) => m.key === (picked ?? FIRST_MOVE.key))
  );
  const move = EMPTY_MOVES[index];
  const glyph = MOVE_GLYPH[move.key];

  return (
    <section className={`${PANEL} overflow-hidden`} aria-label={t("buildOrder.title")}>
      {/* Step zero: a quiet full-width row, NOT a fourth move. It carries no
          numeral and no glyph, so the sheet below still reads as three items
          whether it is present or absent. */}
      {setupUnfinished ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-dashed border-stone-300 bg-stone-50 px-5 py-3">
          <Settings2 size={16} className="shrink-0 text-steel" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className={META_LABEL}>{t("buildOrder.setupLead")}</p>
            <p className="mt-0.5 text-base font-medium text-ink">{t("setupTitle")}</p>
          </div>
          <button type="button" onClick={onResumeSetup} className={`${BTN_GHOST} h-8 shrink-0 px-3 text-sm`}>
            {t("setupResume")} <ArrowRight size={13} aria-hidden />
          </button>
        </div>
      ) : null}

      <div className="px-5 pt-5">
        <p className={EYEBROW}>{t("buildOrder.eyebrow")}</p>
        <h2 className={`mt-1 ${TITLE_DISPLAY}`}>{t("buildOrder.title")}</h2>
      </div>

      {/* The hero: one move, at reading size.
          The drawn subject sits OUTSIDE the crossfade on purpose: it is the one
          thing that persists across a re-aim (there is always a subject), so it
          swaps by redrawing itself on its own key rather than fading with the prose.

          It is also sized and stacked the way `PipelineEmptyFirstCandidate` sized
          its glyph — `GLYPH_SIZE.md shrink-0` in a flex row, and `flex-col` rather
          than `hidden` on a phone. That is not a style preference: a MotionizedGlyph
          placed behind a `hidden` / `sm:block` toggle (on the svg OR on a wrapper)
          lays out at full size and paints NOTHING in Chromium, verified here by
          cloning the same node with and without the classes (the setup checklist's
          briefing glyph passed exactly that string and never drew). Change the
          stacking, never the display. */}
      <div className="flex flex-col items-start gap-4 px-5 py-4 sm:flex-row sm:gap-5">
        <MotionizedGlyph
          key={move.key}
          data={glyph.data}
          viewBox={glyph.viewBox}
          spread={0.9}
          className={`${GLYPH_SIZE.md} shrink-0`}
        />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={move.key}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 1 } : { opacity: 0, y: -6 }}
            transition={reduced ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}
            className="min-w-0"
          >
            <p className={META_LABEL}>{t("buildOrder.stepOf", { n: index + 1, total: EMPTY_MOVES.length })}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h3 className="font-serif text-h2 text-ink">{t(`moves.${move.key}.title`)}</h3>
              {move.optional ? <span className={`${CHIP_QUIET} text-meta uppercase`}>{t("optional")}</span> : null}
            </div>
            <p className="mt-2 max-w-2xl text-base text-steel">{t(`moves.${move.key}.body`)}</p>
            <button type="button" onClick={() => go(move.tab)} className={`${BTN_PRIMARY} mt-3 h-9 px-4 text-sm`}>
              {t(`moves.${move.key}.action`)} <ArrowRight size={14} aria-hidden />
            </button>
          </motion.div>
        </AnimatePresence>
      </div>

      <ol aria-label={t("buildOrder.rail")} className={`mx-5 flex flex-col gap-1 ${DIVIDER} py-2 sm:flex-row sm:gap-2`}>
        {EMPTY_MOVES.map((m, i) => (
          <OrderTick
            key={m.key}
            index={i}
            label={t(`moves.${m.key}.title`)}
            active={m.key === move.key}
            reduced={reduced}
            onSelect={() => setPicked(m.key)}
          />
        ))}
      </ol>

      {/* What the three moves are FOR: the funnel, as a caption. */}
      <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${DIVIDER} px-5 py-3`}>
        <span className={META_LABEL}>{t("buildOrder.then")}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1">
          {STAGES.map((stage, i) => (
            <span key={stage} className="flex items-center gap-1 text-sm text-steel">
              {i > 0 ? <ChevronRight size={12} className="text-stone-300" aria-hidden /> : null}
              {enumLabel("stage", stage)}
            </span>
          ))}
        </span>
      </div>

      {onStartTour ? (
        <div className={`${DIVIDER} px-5 py-3`}>
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
