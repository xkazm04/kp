"use client";

// The drawer's AI-actions grid (screen / prep / scorecard / offer / outreach /
// rejection / rematch), filtered to the entry's current stage and status. Split
// out of PipelineCandidateDrawer.tsx.

import { Ban, Banknote, ClipboardList, Mail, Shuffle, Sparkles, UserCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { DEFAULT_STAGE_AXIS, type StageDef } from "@/app/_lib/pipeline-stages";
import { pipelineDrawerActionIds } from "./pipelineDrawerActions";
// The drawer's narrow Pick of the board record — this helper only reads stage and
// status, and typing it against the full board Entry would reject its only caller.
import type { Entry, TaskId } from "./PipelineCandidateDrawerTypes";
import type { Result } from "./PipelineCandidateDrawerTypes";

// The glyph each action wears. The ORDER and the stage gating live in the pure
// pipelineDrawerActions module (unit-tested against a renamed axis); this map is
// the render half, and there is no English `label` beside it — the button text is
// resolved from the catalog (`pipeline.actions.<id>`) in four locales.
const ACTION_ICON: Record<TaskId, typeof Mail> = {
  screen: UserCheck,
  prep: ClipboardList,
  scorecard: ClipboardList,
  offer: Banknote,
  outreach: Mail,
  rejection: Ban,
  rematch: Shuffle,
};

export type DrawerAction = { id: TaskId; icon: typeof Mail };

/** The AI actions offered for `entry` on THIS workspace's board, in funnel order. */
export function pipelineDrawerActionsFor(entry: Entry, axis: readonly StageDef[] = DEFAULT_STAGE_AXIS): DrawerAction[] {
  return pipelineDrawerActionIds(entry, axis).map((id) => ({ id, icon: ACTION_ICON[id] }));
}

export function PipelineAiActionsGrid({
  actions,
  busy,
  result,
  onRun,
}: {
  actions: DrawerAction[];
  busy: TaskId | null;
  result: Result | null;
  onRun: (task: TaskId) => void;
}) {
  const t = useTranslations("pipeline.drawer");
  const tActions = useTranslations("pipeline.actions");
  return (
    <div>
      <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-coral">
        <Sparkles size={13} /> {t("aiActions")}
      </p>
      <p className="mt-1 text-sm text-steel">{t("aiActionsNote")}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {actions.map((act) => (
          <button
            key={act.id}
            type="button"
            onClick={() => onRun(act.id)}
            disabled={busy !== null}
            className={`focus-ring flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
              result?.task === act.id ? "border-coral bg-coral/5 text-coral" : "border-stone-200 bg-white text-ink hover:border-coral/40"
            }`}
          >
            <act.icon size={14} className="shrink-0 text-coral" />
            {busy === act.id ? t("working") : tActions(act.id)}
          </button>
        ))}
      </div>
    </div>
  );
}
