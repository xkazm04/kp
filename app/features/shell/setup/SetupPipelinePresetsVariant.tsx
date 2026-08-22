"use client";

/**
 * Pipeline step — variant "presets".
 *
 * Metaphor: **three recipes, then the knobs.** A first-run operator usually has
 * an opinion about how many conversations their hiring takes, and none at all
 * about "stage roles". So the editor leads with three named funnel shapes — keep
 * what ships, run it lean, add a work sample — as sticker tiles, and only then
 * offers the row-by-row editor underneath.
 *
 * ONE chain, not four. Each tile used to draw its own resulting funnel, which put
 * three unpicked futures on screen beside the one that is actually loaded and made
 * a 3-up grid of tiles read as a wall of chips. The chain now sits once, below the
 * tiles, and shows the CURRENT draft — so it answers "what did that click do to my
 * board" instead of "what would each of these clicks do", and it keeps answering
 * after a hand-edit in the rows below, which a per-tile preview never did.
 *
 * It takes a position, which is the point: one click gets to a coherent funnel
 * instead of five renames, and the three titles teach what the columns are FOR by
 * contrasting three answers.
 *
 * The presets are derived from the workspace's real axis, never invented
 * (setupPipelinePresets.ts): the ids stay canonical and the labels stay whatever
 * this workspace already calls its columns.
 */

import { motion } from "framer-motion";
import { Check, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { BTN_SECONDARY, EYEBROW, META_LABEL } from "@/app/_components/ui/recipes";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { useStageDisplayLabel } from "@/app/features/shared/usePipelineAxisCopy";
import { draftFromStored } from "@/app/features/shared/pipelineAxisDraft";
import { SetupPipelineChain } from "./SetupPipelineChain";
import { SetupPipelineStageRow } from "./SetupPipelineStageRow";
import type { SetupPipelineEdit } from "./setupPipelineEdit";
import { activePipelinePreset, applyPipelinePreset, SETUP_PIPELINE_PRESETS } from "./setupPipelinePresets";

export function SetupPipelinePresetsVariant({ edit }: { edit: SetupPipelineEdit }) {
  const t = useTranslations("setup.pipeline");
  const reduced = useReducedMotion();
  const displayLabel = useStageDisplayLabel();
  const workSampleLabel = t("workSampleLabel");
  // The presets are edits of the axis AS LOADED, not of the current draft — so
  // picking one twice, or picking another after hand-edits, always lands on the
  // same shape instead of compounding.
  const base = draftFromStored(edit.pipeline.stored);
  const active = activePipelinePreset(edit.draft, base, workSampleLabel);
  // Columns the DRAFT adds to the loaded axis — drawn in the accent in the chain
  // below, so "with a work sample" shows which step it is.
  const baseIds = new Set(base.stages.map((s) => s.id));
  const addedIds = edit.stages.filter((s) => !baseIds.has(s.id)).map((s) => s.id);

  return (
    <div className="space-y-5">
      <div>
        <p className={EYEBROW}>{t("presetsLabel")}</p>
        <div className="mt-2 grid gap-2.5 sm:grid-cols-3">
          {SETUP_PIPELINE_PRESETS.map((key, i) => {
            const shape = applyPipelinePreset(key, base, workSampleLabel);
            const selected = active === key;
            return (
              <motion.button
                key={key}
                type="button"
                aria-pressed={selected}
                onClick={() => edit.apply(applyPipelinePreset(key, base, workSampleLabel))}
                initial={reduced ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={reduced ? { duration: 0 } : { duration: 0.25, delay: i * 0.06 }}
                className={`focus-ring flex flex-col gap-1.5 rounded-lg border-2 p-3 text-left transition-colors ${
                  selected
                    ? "border-ink bg-paper shadow-sticker-sm dark:-rotate-1"
                    : "border-stone-200 bg-white hover:border-ink/40"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink">{t(`presets.${key}.title`)}</span>
                  {/* The count stays when the tile is picked — it is the fact the
                      reader is comparing, and swapping it for the checkmark hid
                      exactly the number they had just chosen on. */}
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className={`${META_LABEL} nums`}>{t("stepsCount", { count: shape.stages.length })}</span>
                    {selected ? (
                      <span aria-hidden className="grid h-5 w-5 place-items-center rounded-full bg-ink text-white">
                        <Check size={12} />
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="text-sm text-steel">{t(`presets.${key}.body`)}</span>
              </motion.button>
            );
          })}
        </div>
        {/* The result of the click that just happened, and of every rename and
            reorder made below it — the tiles' claim, shown rather than described. */}
        <div className="mt-2.5 rounded-md border border-stone-200 bg-paper/50 px-2.5 py-2">
          <p className={META_LABEL}>{t("chainLabel")}</p>
          <SetupPipelineChain
            stages={edit.stages.map((s) => ({ id: s.id, label: displayLabel(s) }))}
            addedIds={addedIds}
            className="mt-1"
          />
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={EYEBROW}>{t("fineTuneLabel")}</p>
          <span className={META_LABEL}>{t("meta", { count: edit.stages.length, max: edit.max })}</span>
        </div>
        <ol className="mt-2 space-y-1.5">
          {edit.stages.map((stage, i) => (
            <SetupPipelineStageRow key={stage.id} edit={edit} stage={stage} index={i} />
          ))}
        </ol>
        <button
          type="button"
          onClick={edit.add}
          disabled={edit.atMax}
          className={`${BTN_SECONDARY} mt-2 h-8 gap-1.5 px-2.5 text-sm font-semibold`}
        >
          <Plus size={13} className="text-coral" aria-hidden /> {t("addStep")}
        </button>
      </div>
    </div>
  );
}
