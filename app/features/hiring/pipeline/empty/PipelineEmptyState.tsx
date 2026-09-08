"use client";

/**
 * The pipeline board's empty state — PROTOTYPE HOST (round 1 of the /prototype
 * loop; the tab strip is throwaway and goes away when the owner prunes).
 *
 * It renders one of two DIRECTIONAL variants behind a labelled switcher. Both
 * take these exact props, so pruning is deleting a file and an entry, and the
 * consumer (PipelineTab) never changes:
 *
 *   - `PipelineEmptyStageSet`   "the stage set"   the board teaches the funnel
 *   - `PipelineEmptyBuildOrder` "the build order" the work is a ranked sequence
 *
 * WHAT THE ROUND IS FOR. The previous empty state drew the funnel well and the
 * owner is keeping that idea, but it led the operator with "set up a channel"
 * and "add a candidate manually" — backwards (nothing can arrive before a role
 * exists) and, in the second case, not true (that link lands on the archetype
 * roster, which cannot put anyone on the board). The order both variants teach
 * is declared once in `pipelineEmptyMoves.ts` and pinned by its test.
 *
 * STEP ZERO. The Getting-started checklist was deleted in the same change, and it
 * was the only door back into the first-run wizard for an operator who left it
 * early. That door lives here now: `setupUnfinished` turns on ONE full-width band
 * per variant, never a fourth peer step, so each surface reads whole with it and
 * without it.
 */

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { PipelineEmptyStageSet } from "./PipelineEmptyStageSet";
import { PipelineEmptyBuildOrder } from "./PipelineEmptyBuildOrder";

export type PipelineEmptyStateProps = {
  /** The operator left the first-run wizard early: offer to finish it as step zero. */
  setupUnfinished: boolean;
  onResumeSetup: () => void;
  /** Absent when the guided tour is already running. */
  onStartTour?: () => void;
};

type VariantId = "stageSet" | "buildOrder";

export function PipelineEmptyState(props: PipelineEmptyStateProps): React.JSX.Element {
  const t = useTranslations("pipeline.emptyState");
  const reduced = useReducedMotion();
  const [variant, setVariant] = useState<VariantId>("stageSet");

  const option = (id: VariantId, label: string, hint: string) => ({
    value: id,
    label: (
      <span className="block text-left">
        <span className="block text-base font-semibold">{label}</span>
        <span className={`block text-sm ${variant === id ? "text-white/75" : "text-steel"}`}>{hint}</span>
      </span>
    ),
  });

  return (
    <div className="space-y-3">
      {/* Deliberately ugly: a dashed scaffold nobody could mistake for shipped chrome. */}
      <div className="rounded-lg border border-dashed border-stone-300 p-3">
        <p className={`mb-2 ${META_LABEL}`}>{t("proto.eyebrow")}</p>
        <SegmentedControl
          label={t("proto.label")}
          value={variant}
          onChange={setVariant}
          options={[
            option("stageSet", t("proto.stageSet"), t("proto.stageSetHint")),
            option("buildOrder", t("proto.buildOrder"), t("proto.buildOrderHint")),
          ]}
        />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={variant}
          initial={reduced ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 1 } : { opacity: 0, y: -4 }}
          transition={reduced ? { duration: 0 } : { duration: 0.16, ease: "easeOut" }}
        >
          {variant === "stageSet" ? <PipelineEmptyStageSet {...props} /> : <PipelineEmptyBuildOrder {...props} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
