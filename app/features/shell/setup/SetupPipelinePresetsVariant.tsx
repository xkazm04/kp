"use client";

/**
 * Pipeline step — variant "presets".
 *
 * Metaphor: **three recipes, then the knobs.** A first-run operator usually has
 * an opinion about how many conversations their hiring takes, and none at all
 * about "stage roles". So the step leads with three named funnel shapes — keep
 * what ships, run it lean, add a work sample — as sticker tiles that show the
 * resulting chain, and only then offers the row-by-row editor underneath.
 *
 * Differs from the board variant: it takes a position. One click gets to a
 * coherent funnel instead of five renames, and the tiles teach what the columns
 * are FOR by contrasting three answers. The trade is that it doesn't show the
 * board — the chain is a summary, not a preview.
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
  const baseIds = new Set(base.stages.map((s) => s.id));

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
                {/* The actual resulting funnel — the tile's claim, shown rather
                    than described. A column this shape ADDS is drawn in accent. */}
                <SetupPipelineChain
                  stages={shape.stages.map((s) => ({ id: s.id, label: displayLabel(s) }))}
                  addedIds={shape.stages.filter((s) => !baseIds.has(s.id)).map((s) => s.id)}
                  className="mt-0.5"
                />
              </motion.button>
            );
          })}
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
