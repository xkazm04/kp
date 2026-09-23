"use client";

// PIPE4 — the per-stage aging cadence row, shown while the filter bar's "Aging SLAs"
// toggle is active. Split out of PipelineTab.tsx.
//
// One input per column THIS WORKSPACE renders, in board order, minus the terminal
// one (a hired candidate has no clock). The value is the TEAM's cadence for the
// column (`slaDays` on the workspace axis, challenge-r03 pipeline-board-ui/A): the
// same number the sidebar badge and the automation pass age on, saved for everyone
// on the team through PATCH /api/pipeline/stage-sla. It used to be saved "for this
// browser", so two recruiters aged one board differently. The placeholder is the
// ROLE default a blank field falls back to.
//
// A save commits on blur or Enter, not per keystroke: each commit is a team policy
// write, and typing "14" must not write 1 on the way.

import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { LocalSlaOffer } from "@/app/_lib/stage-sla";
import { BTN_GHOST, BTN_SECONDARY } from "@/app/_components/ui/recipes";
import type { PipelineTabTranslator } from "./pipelineTranslator";
import { DEFAULT_BOARD_AXIS, ROLE_SLA_DEFAULTS, type StageDef } from "@/app/features/shared/pipelineTypes";
import { SLA_MAX_DAYS, SLA_MIN_DAYS, clampSlaDays } from "./pipelineSla";

export function PipelineSlaEditor({
  t,
  enumLabel,
  axis = DEFAULT_BOARD_AXIS,
  slaOverrides,
  onChangeStageSla,
  saveError = null,
  localOffers = [],
  onAdoptLocal,
  onDiscardLocal,
}: {
  t: PipelineTabTranslator;
  enumLabel: (kind: string, value: string) => string;
  /** The board's resolved axis (GET /api/pipeline), carrying the team's `slaDays`.
   *  Optional so a standalone render still shows the shipped five. */
  axis?: readonly StageDef[];
  /** Optimistic values between a save and the reload that returns them. */
  slaOverrides: Record<string, number>;
  onChangeStageSla: (stage: string, days: number | null) => void;
  /** The last save's failure payload, resolved here by CODE (never the server's English). */
  saveError?: ApiErrorPayload | null;
  /** Leftover per-browser cadences from before they were team data, offered once. */
  localOffers?: readonly LocalSlaOffer[];
  onAdoptLocal?: () => void;
  onDiscardLocal?: () => void;
}) {
  const errorMessage = useErrorMessage();
  // A workspace's own label wins; a shipped stage (label === id) keeps resolving
  // through enums.stage.* so it stays localized — the board header's rule.
  const columnLabel = (stage: StageDef): string =>
    stage.label === stage.id ? enumLabel("stage", stage.id) : stage.label;
  const labelFor = (id: string): string => {
    const stage = axis.find((s) => s.id === id);
    return stage ? columnLabel(stage) : id;
  };
  const teamValue = (stage: StageDef): number | null => slaOverrides[stage.id] ?? stage.slaDays ?? null;
  const commit = (stage: StageDef, raw: string) => {
    // The min/max on the input are ADVISORY (a native number input colours an
    // out-of-range value, it does not refuse a paste). clampSlaDays holds the same
    // [1, 365] the server enforces; empty/0/garbage clears back to the role default.
    const next = clampSlaDays(raw);
    if (next === teamValue(stage)) return;
    onChangeStageSla(stage.id, next);
  };
  return (
    <div className="flex flex-col gap-2 rounded-md border border-stone-200 bg-paper px-3 py-2">
      <div className="flex flex-wrap items-end gap-3">
        <span className="text-meta uppercase tracking-wide text-steel">{t("slaEditorTitle")}</span>
        {axis
          .filter((s) => s.role !== "terminal")
          .map((stage) => {
            const value = teamValue(stage);
            return (
              <label key={stage.id} className="flex flex-col text-meta text-steel">
                {columnLabel(stage)}
                <input
                  // Re-keyed on the team value so a reload (or another recruiter's
                  // save picked up by the poll) repaints the field.
                  key={`${stage.id}:${value ?? ""}`}
                  type="number"
                  min={SLA_MIN_DAYS}
                  max={SLA_MAX_DAYS}
                  defaultValue={value ?? ""}
                  placeholder={String(ROLE_SLA_DEFAULTS[stage.role])}
                  onBlur={(ev) => commit(stage, ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") commit(stage, ev.currentTarget.value);
                  }}
                  className="focus-ring mt-0.5 h-8 w-16 rounded-md border border-stone-200 bg-white px-2 text-sm nums text-ink caret-coral"
                />
              </label>
            );
          })}
        <span className="text-meta text-steel">{t("slaEditorNote")}</span>
        {/* The clamp, stated where it bites: a recruiter typing 400 needs to know the
            board stored 365, not wonder why aging went quiet. */}
        <span className="text-meta text-steel">{t("slaEditorRange", { min: SLA_MIN_DAYS, max: SLA_MAX_DAYS })}</span>
      </div>
      {saveError && (
        <p role="alert" className="text-meta text-red-700">
          {errorMessage(saveError, t("slaSaveFailed"))}
        </p>
      )}
      {localOffers.length > 0 && onAdoptLocal && onDiscardLocal && (
        <div className="flex flex-wrap items-center gap-2 text-meta text-steel">
          <span>
            {t("slaLocalOffer", {
              count: localOffers.length,
              list: localOffers.map((o) => t("slaLocalItem", { stage: labelFor(o.stage), days: o.days })).join(", "),
            })}
          </span>
          <button type="button" onClick={onAdoptLocal} className={`${BTN_SECONDARY} h-7 px-2 text-meta`}>
            {t("slaLocalAdopt")}
          </button>
          <button type="button" onClick={onDiscardLocal} className={`${BTN_GHOST} h-7 px-2 text-meta`}>
            {t("slaLocalDiscard")}
          </button>
        </div>
      )}
    </div>
  );
}
