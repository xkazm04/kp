"use client";

/**
 * Variant A — "the next move".
 *
 * Metaphor: a briefing, not a to-do list. A first-run operator staring at five
 * simultaneous chores has five ways to be wrong; this variant answers exactly one
 * question — *what do I do right now* — by promoting the first unfinished core
 * step to a full-width briefing block (what it is, what it buys you, one primary
 * action) and demoting everything else to a thin ordered rail underneath.
 *
 * Differs from the baseline: the baseline shows all five steps at equal weight in
 * a two-column grid, so the eye has to rank them. Here the product ranks them and
 * says so. The rail is still fully navigable — clicking a step brings it into the
 * briefing — so nothing is hidden, only ordered.
 *
 * Illustration: the promoted block carries the focused step's traced glyph (one
 * /motionize family of five — workspace, JD, dev case, inbound, teammates), so the
 * briefing has a subject you can see before you read it. Deliberately 80px, not a
 * hero: `PipelineEmptyFirstCandidate` sits directly below on a fresh workspace with
 * its own 96px glyph, and two full-size illustrations stacked would give the page
 * two focal points and no hierarchy. The rail stays glyph-free — its markers carry
 * done/pending/active state, which a 20px illustration would both hide and blur.
 *
 * Honesty: the briefing target, the rail marks and the progress ratio are all
 * derived from the server payload in getting-started-model.ts. The rail never
 * shows a step as done that isn't, and an in-flight sub-state ("building now",
 * "listening") is rendered as its own third state — never as completion.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, X } from "lucide-react";
import { PANEL, EYEBROW, BTN_PRIMARY, BTN_GHOST, META_LABEL } from "@/app/_components/ui/recipes";
import { MotionizedGlyph } from "@/app/_components/glyph/MotionizedGlyph";
import { STEP_GLYPHS } from "./setupStepGlyphs";
import {
  STEPS,
  CORE_STEPS,
  coreDoneCount,
  nextStep,
  stepDone,
  stepNote,
  type GettingStartedViewProps,
  type Step,
  type StepKey,
} from "./setupGettingStartedModel";
import { useOpenStep, useShowMe } from "./setupGettingStartedModel";
import { SetupGettingStartedRailStep } from "./SetupGettingStartedRailStep";

export function GettingStartedNextMove({ data, dismiss }: GettingStartedViewProps) {
  const t = useTranslations("setup.checklist");
  const open = useOpenStep();
  const showMe = useShowMe();
  // The operator may steer the briefing to any step; until they do, the product
  // picks the honest next one.
  const [picked, setPicked] = useState<StepKey | null>(null);

  const auto = nextStep(data);
  const focused: Step = STEPS.find((s) => s.key === picked) ?? auto ?? STEPS[STEPS.length - 1];
  const done = coreDoneCount(data);
  const total = CORE_STEPS.length;
  const note = stepNote(focused.key, data);
  const focusedDone = stepDone(focused.key, data);
  const glyph = STEP_GLYPHS[focused.key];

  const body = focusedDone
    ? t("completed.body")
    : note === "analyzing"
      ? t("steps.firstRole.analyzing")
      : note === "failed"
        ? t("steps.firstRole.failed")
        : note === "listening"
          ? t("steps.channels.listening")
          : t(`steps.${focused.key}.body`);

  return (
    <section aria-label={t("title")} className={`${PANEL} p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          {/* The briefing's subject, drawn. Indexed from a map — never a component
              factory called during render (React-compiler rule). Remounted on the
              focused key so re-aiming the briefing replays the reveal. */}
          <MotionizedGlyph
            key={focused.key}
            data={glyph.data}
            viewBox={glyph.viewBox}
            entrance="staggered-draw"
            spread={0.9}
            className="hidden h-20 w-20 shrink-0 sm:block"
          />
          <div className="min-w-0">
            <p className={EYEBROW}>{t("title")}</p>
            <p className="mt-1 font-serif text-h3 text-ink">
              {focusedDone ? t("completed.title") : t(`steps.${focused.key}.title`)}
            </p>
            <p className="mt-2 max-w-2xl text-base text-steel">{body}</p>

            {!focusedDone ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => open(focused)} className={`${BTN_PRIMARY} h-9 px-4 text-sm`}>
                  {t("open")} <ArrowRight size={14} aria-hidden />
                </button>
                <button type="button" onClick={() => showMe(focused)} className={`${BTN_GHOST} h-9 px-3 text-sm`}>
                  {t("showMe")}
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className={META_LABEL}>{t("progress", { done, total })}</p>
            <div aria-hidden className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-stone-100">
              <div className="h-full rounded-full bg-moss" style={{ width: `${(done / total) * 100}%` }} />
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="focus-ring rounded-full p-1.5 text-steel hover:text-ink"
            aria-label={t("dismiss")}
            title={t("dismiss")}
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      </div>

      <ol className="mt-4 flex flex-col gap-1 border-t border-stone-200 pt-3 sm:flex-row sm:items-start sm:gap-2">
        {STEPS.map((step, i) => (
          <SetupGettingStartedRailStep
            key={step.key}
            step={step}
            index={i}
            done={stepDone(step.key, data)}
            pending={stepNote(step.key, data) !== null}
            active={step.key === focused.key}
            label={t(`steps.${step.key}.title`)}
            optional={step.key === "team"}
            onSelect={setPicked}
          />
        ))}
      </ol>
    </section>
  );
}
