"use client";

/**
 * Pipeline step — read-only view "journey".
 *
 * Metaphor: **the process read as a sentence, top to bottom.** One numbered stop
 * per column, each carrying its own glyph, its name, and the one plain line that
 * says what actually happens there ("You read what they sent and pick who to talk
 * to"). A dashed spine joins the stops, so the eye travels the funnel in the same
 * direction a candidate does.
 *
 * It won the /prototype round against a columns-preview of the same axis: the
 * preview looked more like the app, but a first-run reader does not recognise that
 * screen yet, so recognition bought nothing while explanation bought everything.
 *
 * NO ROLE CHIP, AND NO UPPERCASE. Each stop used to carry its role name in the
 * uppercase-tracked `text-meta` label — "ARRIVES HERE", "SCREENING" — which both
 * shouted and duplicated: the sentence underneath already SAYS what the role
 * means, in words that need no vocabulary lesson ("Everyone who applies lands here
 * first" is the entry role, stated). The chip was deleted rather than re-cased,
 * because a quieter typeface would not have made it carry any more meaning. The
 * role still drives the glyph, where it costs no words at all.
 *
 * Nothing here is editable. Every affordance lives behind the step's edit mode,
 * which keeps this component safe to render anywhere a hiring process needs to be
 * understood (the hand-off summary is the obvious next taker).
 */

import { motion } from "framer-motion";
import { Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { usePipelineStageRoleMeaning, useStageDisplayLabel } from "@/app/features/shared/usePipelineAxisCopy";
import type { SetupPipelineEdit } from "./setupPipelineEdit";
import { stageRoleIcon } from "./setupPipelineRoleIcon";

export function SetupPipelineJourneyView({ edit }: { edit: SetupPipelineEdit }) {
  const t = useTranslations("setup.pipeline");
  const reduced = useReducedMotion();
  const displayLabel = useStageDisplayLabel();
  const roleMeaning = usePipelineStageRoleMeaning();

  return (
    <ol className="space-y-1" aria-label={t("boardAria")}>
      {edit.stages.map((stage, i) => {
        const Icon = stageRoleIcon(stage.role);
        const here = edit.occupants(stage);
        const last = i === edit.stages.length - 1;
        return (
          <motion.li
            key={stage.id}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduced ? { duration: 0 } : { duration: 0.25, delay: Math.min(i * 0.05, 0.3) }}
            className="flex gap-3"
          >
            {/* The spine: glyph tile, then a dashed rule down to the next stop. It
                is drawn per-item rather than as one absolute line so a stop that
                wraps to two lines still joins up. */}
            <div className="flex shrink-0 flex-col items-center">
              <span
                aria-hidden
                className="grid h-9 w-9 place-items-center rounded-xl border-2 border-ink bg-white text-ink shadow-sticker-xs dark:-rotate-2"
              >
                <Icon size={16} />
              </span>
              {last ? null : <span aria-hidden className="mt-1 w-0 flex-1 border-l-2 border-dashed border-stone-300" />}
            </div>

            <div className={`min-w-0 ${last ? "" : "pb-3"}`}>
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="nums text-sm text-stone-400">{i + 1}</span>
                <span className="text-base font-semibold text-ink">{displayLabel(stage)}</span>
                {/* Only when it is true — the wizard also opens over a populated
                    workspace (Settings → "Preview onboarding"), and there the
                    count is the fact that makes this step feel real. */}
                {here > 0 ? (
                  <span className="inline-flex items-center gap-1 text-sm text-steel" title={t("hereNow", { count: here })}>
                    <Users size={12} aria-hidden /> <span className="nums">{here}</span>
                  </span>
                ) : null}
              </p>
              <p className="max-w-[46ch] text-sm text-steel">{roleMeaning(stage.role)}</p>
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}
