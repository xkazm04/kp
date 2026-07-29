"use client";

// PIPE4 — the per-stage aging SLA override row, shown while the filter bar's
// "Aging SLAs" toggle is active. Split out of PipelineTab.tsx.

import type { PipelineTabTranslator } from "./pipelineTranslator";
import { STAGES, STAGE_SLA_DEFAULTS } from "@/app/features/shared/pipelineTypes";

export function PipelineSlaEditor({
  t,
  enumLabel,
  slaOverrides,
  onChangeStageSla,
}: {
  t: PipelineTabTranslator;
  enumLabel: (kind: string, value: string) => string;
  slaOverrides: Record<string, number>;
  onChangeStageSla: (stage: string, days: number | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border border-stone-200 bg-paper px-3 py-2">
      <span className="text-meta uppercase tracking-wide text-steel">{t("slaEditorTitle")}</span>
      {STAGES.filter((s) => s !== "Hired").map((stage) => (
        <label key={stage} className="flex flex-col text-meta text-steel">
          {enumLabel("stage", stage)}
          <input
            type="number"
            min={1}
            max={365}
            value={slaOverrides[stage] ?? ""}
            placeholder={String(STAGE_SLA_DEFAULTS[stage] ?? "")}
            onChange={(ev) => {
              const n = parseInt(ev.target.value, 10);
              onChangeStageSla(stage, Number.isFinite(n) ? n : null);
            }}
            className="focus-ring mt-0.5 h-8 w-16 rounded-md border border-stone-200 bg-white px-2 text-sm nums text-ink caret-coral"
          />
        </label>
      ))}
      <span className="text-meta text-steel">{t("slaEditorNote")}</span>
    </div>
  );
}
