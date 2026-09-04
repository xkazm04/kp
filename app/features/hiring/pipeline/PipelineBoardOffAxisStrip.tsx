"use client";

// Candidates standing on a column this board does not draw.
//
// This strip exists because the axis became editable. While the five columns were
// a compile-time constant, an unknown stage could only be a legacy row, and
// `bucketLaneEntries` folding it into column 0 was the right trade: visible and
// slightly wrong beats invisible. The moment a workspace can REMOVE a column that
// fold turns into the worst possible behaviour — a dozen candidates silently
// reappearing at the top of the funnel, looking exactly like a mass reset, with
// nothing on screen to say what happened.
//
// So they get named, counted, and given the one control that resolves the
// situation: move them somewhere that exists. The stage's own label is recovered
// from the RETIRED list when possible, so the strip says "Second interview" — the
// column the recruiter deleted — rather than a bare id.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Select } from "@/app/_components/Select";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import { moveTargetStages } from "./pipelineMoveTargets";
import { cappedWithOverflow } from "./pipelineBoardLayout";
import type { Entry } from "@/app/features/shared/pipelineTypes";

export function PipelineBoardOffAxisStrip({
  entries,
  retiredStages,
  axis,
  openProfile,
  onMove,
}: {
  entries: Entry[];
  retiredStages: readonly StageDef[];
  axis: readonly StageDef[];
  openProfile: (e: Entry) => void;
  /** Omitted when the board is read-only (select mode); the strip then names the
   *  problem without offering a control that would do nothing. */
  onMove?: (entry: Entry, toStage: string) => void;
}) {
  const t = useTranslations("pipeline.offAxis");
  const tBoard = useTranslations("pipeline.board");
  const enumLabel = useEnumLabel();
  // Same ceiling as a stage cell, for the same reason and with the same control.
  // A cell caps at CELL_LIMIT and offers "+N more"; this strip used to render EVERY
  // stranded card at once — and it is longest exactly when that hurts most, since a
  // column is usually retired because it held people. Expansion is per stranded
  // GROUP (one retired column each), so revealing one group leaves the others capped.
  const [expandedStages, setExpandedStages] = useState<ReadonlySet<string>>(() => new Set());
  const toggleStage = (stageId: string) =>
    setExpandedStages((prev) => {
      const next = new Set(prev);
      if (!next.delete(stageId)) next.add(stageId);
      return next;
    });

  // A retired stage keeps its label; anything else is a stage no axis has ever
  // declared (a legacy row, an older build) and can only be shown as its id.
  const stageLabel = (id: string): string => {
    const retired = retiredStages.find((s) => s.id === id);
    if (retired) return retired.label === retired.id ? enumLabel("stage", retired.id) : retired.label;
    return id;
  };
  const targets = moveTargetStages("", axis);
  const targetLabel = (id: string): string => {
    const stage = axis.find((s) => s.id === id);
    if (!stage) return id;
    return stage.label === stage.id ? enumLabel("stage", stage.id) : stage.label;
  };

  // Group by the stage they are stranded on: one heading per removed column reads
  // as "this is what deleting that column did", which is the actual story.
  const byStage = new Map<string, Entry[]>();
  for (const e of entries) byStage.set(e.stage, [...(byStage.get(e.stage) ?? []), e]);

  return (
    <section aria-label={t("title")} className="border-t border-amber-300 bg-amber-50 px-4 py-3">
      <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-amber-800">
        <AlertTriangle size={12} aria-hidden /> {t("title")}
      </p>
      <p className="mt-1 text-sm text-amber-800">{t("intro", { count: entries.length })}</p>

      <div className="mt-2 space-y-2">
        {[...byStage.entries()].map(([stageId, stranded]) => {
          const isExpanded = expandedStages.has(stageId);
          const { visible, overflow } = cappedWithOverflow(stranded, isExpanded);
          const hidden = cappedWithOverflow(stranded, false).overflow;
          return (
          <div key={stageId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-sm font-semibold text-ink">{t("onStage", { stage: stageLabel(stageId), count: stranded.length })}</span>
            <ul className="flex flex-wrap items-center gap-1.5">
              {visible.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => openProfile(e)}
                    className="focus-ring rounded-full border border-amber-300 bg-white px-2.5 py-0.5 text-sm text-ink hover:border-coral/40 hover:text-coral"
                  >
                    {e.candidateLabel}
                  </button>
                </li>
              ))}
              {overflow > 0 || isExpanded ? (
                <li>
                  <button
                    type="button"
                    onClick={() => toggleStage(stageId)}
                    aria-expanded={isExpanded}
                    className="focus-ring rounded px-1 text-sm font-semibold text-amber-800 hover:text-coral"
                  >
                    {isExpanded ? tBoard("showFewer") : tBoard("moreCount", { count: hidden })}
                  </button>
                </li>
              ) : null}
            </ul>
            {onMove ? (
              <Select
                value=""
                onChange={(toStage) => {
                  if (!toStage) return;
                  // One click resolves the whole group — a per-candidate move here
                  // would be busywork, since they were all stranded by one edit.
                  for (const e of stranded) onMove(e, toStage);
                }}
                ariaLabel={t("moveAria", { stage: stageLabel(stageId) })}
                size="sm"
                options={[{ value: "", label: t("moveAll") }, ...targets.map((id) => ({ value: id, label: targetLabel(id) }))]}
              />
            ) : null}
          </div>
          );
        })}
      </div>
    </section>
  );
}
