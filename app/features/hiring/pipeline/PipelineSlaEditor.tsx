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
import { SLA_MAX_DAYS, SLA_MIN_DAYS, clampSlaDays } from "./pipelineSla";

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
              min={SLA_MIN_DAYS}
              max={SLA_MAX_DAYS}
              value={slaOverrides[stage.id] ?? ""}
              placeholder={String(slaForStage(stage.id, null, axis))}
              // The min/max above are ADVISORY — a native number input colours an
              // out-of-range value, it does not refuse a paste or an arrow-key
              // overshoot. Without this the typed 5000 persisted and silenced the
              // column's aging dot for fourteen years. clampSlaDays holds the same
              // [1, 365] the field declares, and empty/0/garbage clears back to the
              // role default the placeholder shows (pipelineSla.ts, unit-pinned).
              onChange={(ev) => onChangeStageSla(stage.id, clampSlaDays(ev.target.value))}
              className="focus-ring mt-0.5 h-8 w-16 rounded-md border border-stone-200 bg-white px-2 text-sm nums text-ink caret-coral"
            />
          </label>
        ))}
      <span className="text-meta text-steel">{t("slaEditorNote")}</span>
      {/* The clamp, stated where it bites: a recruiter typing 400 needs to know the
          board stored 365, not wonder why aging went quiet. */}
      <span className="text-meta text-steel">{t("slaEditorRange", { min: SLA_MIN_DAYS, max: SLA_MAX_DAYS })}</span>
    </div>
  );
}
