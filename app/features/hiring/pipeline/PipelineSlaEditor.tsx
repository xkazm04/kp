"use client";

// PIPE4 — the per-stage aging SLA override row, shown while the filter bar's
// "Aging SLAs" toggle is active. Split out of PipelineTab.tsx.
//
// One input per column THIS WORKSPACE renders, in board order, minus the terminal
// one (a hired candidate has no clock). The row used to iterate the shipped five
// names, so on a composed board (Settings → Hiring) it offered inputs for columns
// the board no longer drew and none for the ones it did — a recruiter who had
// added a "Tech round" could see it age but never tune it. The placeholder is the
// default the column actually ages against: its ROLE's threshold, resolved by the
// same slaForStage the board's amber dot reads, so the number a recruiter sees
// before typing is the number that is already firing.

import type { PipelineTabTranslator } from "./pipelineTranslator";
import { DEFAULT_BOARD_AXIS, slaForStage, type StageDef } from "@/app/features/shared/pipelineTypes";

export function PipelineSlaEditor({
  t,
  enumLabel,
  axis = DEFAULT_BOARD_AXIS,
  slaOverrides,
  onChangeStageSla,
}: {
  t: PipelineTabTranslator;
  enumLabel: (kind: string, value: string) => string;
  /** The board's resolved axis (GET /api/pipeline). Optional so a standalone render
   *  still shows the shipped five, like every other axis-taking call site. */
  axis?: readonly StageDef[];
  slaOverrides: Record<string, number>;
  onChangeStageSla: (stage: string, days: number | null) => void;
}) {
  // A workspace's own label wins; a shipped stage (label === id) keeps resolving
  // through enums.stage.* so it stays localized — the board header's rule.
  const columnLabel = (stage: StageDef): string =>
    stage.label === stage.id ? enumLabel("stage", stage.id) : stage.label;
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border border-stone-200 bg-paper px-3 py-2">
      <span className="text-meta uppercase tracking-wide text-steel">{t("slaEditorTitle")}</span>
      {axis
        .filter((s) => s.role !== "terminal")
        .map((stage) => (
          <label key={stage.id} className="flex flex-col text-meta text-steel">
            {columnLabel(stage)}
            <input
              type="number"
              min={1}
              max={365}
              value={slaOverrides[stage.id] ?? ""}
              placeholder={String(slaForStage(stage.id, null, axis))}
              onChange={(ev) => {
                const n = parseInt(ev.target.value, 10);
                onChangeStageSla(stage.id, Number.isFinite(n) ? n : null);
              }}
              className="focus-ring mt-0.5 h-8 w-16 rounded-md border border-stone-200 bg-white px-2 text-sm nums text-ink caret-coral"
            />
          </label>
        ))}
      <span className="text-meta text-steel">{t("slaEditorNote")}</span>
    </div>
  );
}
