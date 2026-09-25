"use client";

import { useTranslations } from "next-intl";
import { Button, Note, SettingRow } from "@/app/_components/kit";
import { KitDialog } from "@/app/_components/kit/KitDialog";
import { inputClass } from "@/app/_components/kit/fields";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { ROLE_SLA_DEFAULTS, type StageDef } from "@/app/features/shared/pipelineTypes";
import { SLA_MAX_DAYS, SLA_MIN_DAYS, clampSlaDays } from "../pipelineSla";
import type { PipelineTabState } from "../usePipelineTabState";

/**
 * PIPE4, the aging cadence per stage, as a kit dialog of SettingRows: one row per column THIS
 * workspace renders, minus the terminal one (a hired candidate has no clock). The value is the
 * TEAM's cadence (`slaDays` on the axis, PATCH /api/pipeline/stage-sla), the placeholder the ROLE
 * default a blank field falls back to. A save commits on blur or Enter, never per keystroke (each
 * commit is a team policy write; typing "14" must not write 1). The clamp is stated where it bites,
 * a failed save says why (by CODE), and a browser's leftover per-browser cadences are offered once.
 */
export function PipelineKitSla({ s, onClose }: { s: PipelineTabState; onClose: () => void }) {
  const tt = useTranslations("pipeline.tab");
  const t = useTranslations("pipeline.kit");
  const enumLabel = useEnumLabel();
  const errorMessage = useErrorMessage();
  const label = (st: StageDef) => (st.label === st.id ? enumLabel("stage", st.id) : st.label);
  const team = (st: StageDef): number | null => s.slaOverrides[st.id] ?? st.slaDays ?? null;
  const commit = (st: StageDef, raw: string) => {
    const next = clampSlaDays(raw);
    if (next !== team(st)) s.setStageSla(st.id, next);
  };

  return (
    <KitDialog title={tt("slaEditorTitle")} subtitle={tt("slaEditorNote")} onClose={onClose} size="lg" actions={<Button label={t("done")} variant="primary" onClick={onClose} />}>
      {s.axis
        .filter((st) => st.role !== "terminal")
        .map((st) => {
          const value = team(st);
          return (
            <SettingRow
              key={st.id}
              name={label(st)}
              consequence={t("slaDefault", { days: ROLE_SLA_DEFAULTS[st.role] })}
              control={
                <input
                  // Re-keyed on the team value so a reload (or a teammate's save the poll brings) repaints it.
                  key={`${st.id}:${value ?? ""}`}
                  type="number"
                  className={inputClass("sm", "k-dialog__num")}
                  aria-label={t("slaFor", { stage: label(st) })}
                  min={SLA_MIN_DAYS}
                  max={SLA_MAX_DAYS}
                  defaultValue={value ?? ""}
                  placeholder={String(ROLE_SLA_DEFAULTS[st.role])}
                  onBlur={(ev) => commit(st, ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") commit(st, ev.currentTarget.value);
                  }}
                />
              }
            />
          );
        })}
      <p className="k-dialog__hint">{tt("slaEditorRange", { min: SLA_MIN_DAYS, max: SLA_MAX_DAYS })}</p>
      {s.slaSaveError ? <Note tone="critical">{errorMessage(s.slaSaveError, tt("slaSaveFailed"))}</Note> : null}
      {s.localSlaOffers.length > 0 ? (
        <Note
          tone="caution"
          action={
            <>
              <Button label={tt("slaLocalAdopt")} variant="secondary" size="sm" onClick={s.adoptLocalSla} />
              <Button label={tt("slaLocalDiscard")} variant="ghost" size="sm" onClick={s.discardLocalSla} />
            </>
          }
        >
          {tt("slaLocalOffer", {
            count: s.localSlaOffers.length,
            list: s.localSlaOffers.map((o) => tt("slaLocalItem", { stage: label(s.axis.find((a) => a.id === o.stage) ?? { id: o.stage, label: o.stage, role: "custom" }), days: o.days })).join(", "),
          })}
        </Note>
      ) : null}
    </KitDialog>
  );
}
