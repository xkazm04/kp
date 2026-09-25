"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import { BulkBar } from "@/app/_components/kit/BulkBar";
import { Menu } from "@/app/_components/kit/Menu";
import { SelectBox } from "@/app/_components/kit/SelectBox";
import { allState, ariaChecked, selectedOutside, toggleAll } from "@/app/_components/kit/selection";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { bulkMoveTargetStages } from "../pipelineMoveTargets";
import type { PipelineTabState } from "../usePipelineTabState";
import type { PipelineKit } from "./usePipelineKit";
import { PipelineKitBulkDetail } from "./PipelineKitBulkDetail";

/**
 * PIPE1 / P2-2 / bdc7fc01, the select mode's batch bar, on the kit BulkBar: how many are selected and
 * how many of them the current view hides (every action acts on the WHOLE selection, so that number is
 * stated before any of them runs), select-all-shown over the KIT LIST's rows, clear, the move with its
 * blast-radius preview and confirm, scheduling links for the selected active cohort, and outreach
 * drafts (an armed confirm when a relay would send them at once). The decide row and the last result
 * sit on the detail line (PipelineKitBulkDetail). All state and every request is usePipelineBulk's.
 */
export function PipelineKitBulk({ s, k }: { s: PipelineTabState; k: PipelineKit }) {
  const tt = useTranslations("pipeline.tab");
  const enumLabel = useEnumLabel();
  const shown = k.rows.map((e) => e.id);
  const all = allState(s.selectedIds, shown);
  const outside = selectedOutside(s.selectedIds, shown);
  const n = s.selectedIds.size;
  const preview = s.bulkResult?.verb === "previewed" ? (s.bulkResult.preview ?? null) : null;
  const targets = bulkMoveTargetStages(s.axis).map((id) => {
    const st = s.axis.find((a) => a.id === id);
    return { value: id, label: st && st.label !== st.id ? st.label : enumLabel("stage", id) };
  });
  const outreachArmed = s.confirmingBulkOutreach;

  return (
    <BulkBar
      count={n}
      label={tt("selectedCount", { count: n })}
      status={
        <>
          <b>{tt("selectedCount", { count: n })}</b>
          {outside > 0 ? <span role="status" className="k-bad"> · {tt("selectedOutsideFilter", { count: outside })}</span> : null}
        </>
      }
      actions={
        <>
          <SelectBox checked={ariaChecked(all)} label={tt("selectAllVisible", { count: shown.length })} onToggle={() => s.updateSelection((cur) => toggleAll(cur, shown))} />
          <span aria-hidden>{tt("selectAllVisible", { count: shown.length })}</span>
          {n > 0 ? <Button label={tt("bulkClear")} variant="ghost" size="sm" onClick={s.clearSelection} /> : null}
          <span className="k-push" />
          <Menu
            label={tt("bulkMoveLabel")}
            size="sm"
            options={targets}
            selected={s.bulkStage ? [s.bulkStage] : []}
            onSelect={s.setBulkStage}
          />
          <Button
            label={preview ? tt("bulkMoveConfirm", { count: preview.moving }) : tt("bulkApply", { count: n })}
            loading={s.bulkBusy}
            loadingLabel={tt("bulkMoving")}
            variant="primary"
            size="sm"
            disabled={!s.bulkStage || n === 0}
            onClick={() => void s.bulkMove()}
          />
          {preview ? <Button label={tt("bulkRejectCancel")} variant="ghost" size="sm" disabled={s.bulkBusy} onClick={() => s.dispatchBulkConfirm({ type: "cancel" })} /> : null}
          {s.selectedActive.length > 0 ? (
            <Button label={tt("bulkInvite", { count: s.selectedActive.length })} variant="secondary" size="sm" disabled={s.bulkBusy} onClick={() => void s.bulkInvite()} />
          ) : null}
          {s.selectedActive.length > 0 ? (
            <Button
              label={s.outreachTaskActive ? tt("bulkDrafting") : outreachArmed ? tt("bulkDraftOutreachConfirm", { count: s.selectedActive.length }) : tt("bulkDraftOutreach", { count: s.selectedActive.length })}
              variant={outreachArmed ? "primary" : "secondary"}
              size="sm"
              disabled={s.bulkBusy || s.outreachTaskActive}
              onClick={() => {
                // With a relay on (or unknown), "draft N" IS "send N": the first click arms a confirm.
                if (s.relayConfigured !== false && !outreachArmed) s.dispatchBulkConfirm({ type: "arm", which: "outreach" });
                else void s.bulkOutreach();
              }}
            />
          ) : null}
          {outreachArmed ? <Button label={tt("bulkRejectCancel")} variant="ghost" size="sm" disabled={s.bulkBusy} onClick={() => s.dispatchBulkConfirm({ type: "cancel" })} /> : null}
        </>
      }
      detail={<PipelineKitBulkDetail s={s} preview={preview} />}
    />
  );
}
