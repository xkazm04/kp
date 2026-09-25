"use client";

import { useTranslations } from "next-intl";
import { Button, Note, TextField, Toggle } from "@/app/_components/kit";
import { KitDialog } from "@/app/_components/kit/KitDialog";
import { nameCollides } from "../pipelineViews";
import type { PipelineTabState } from "../usePipelineTabState";

/**
 * The save / rename dialog of a saved view (views-earn-their-name), on the kit: the name, "open this
 * view by default" on a save, and the overwrite warning BEFORE the commit when the name is taken (a
 * save or rename onto an existing name replaces that view). Enter commits.
 */
export function PipelineKitViewDialog({ s }: { s: PipelineTabState }) {
  const tt = useTranslations("pipeline.tab");
  const d = s.viewDialog;
  if (!d) return null;
  const rename = d.mode === "rename";
  const close = () => s.setViewDialog(null);
  const collides = nameCollides(s.views, d.name, rename ? d.id : undefined);

  return (
    <KitDialog
      title={rename ? tt("renameViewModalTitle") : tt("saveViewModalTitle")}
      subtitle={rename ? tt("renameViewModalSubtitle") : tt("saveViewModalSubtitle")}
      onClose={close}
      actions={
        <>
          <Button label={tt("viewDialogCancel")} variant="ghost" onClick={close} />
          <Button label={rename ? tt("renameViewSubmit") : tt("saveViewSubmit")} variant="primary" disabled={!d.name.trim()} onClick={s.commitViewDialog} />
        </>
      }
    >
      <form
        className="k-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          s.commitViewDialog();
        }}
      >
        <label className="k-dialog__label">
          {tt("viewNameLabel")}
          <TextField label={tt("viewNameLabel")} value={d.name} maxLength={60} placeholder={tt("viewNamePlaceholder")} onChange={(name) => s.setViewDialog({ ...d, name })} />
        </label>
        {d.mode === "save" ? (
          <span className="k-actline__toggle">
            <Toggle on={d.asDefault} label={tt("viewSetDefaultLabel")} onChange={(asDefault) => s.setViewDialog({ ...d, asDefault })} />
            <span>
              {tt("viewSetDefaultLabel")}
              <small className="k-dialog__hint">{tt("viewSetDefaultHint")}</small>
            </span>
          </span>
        ) : null}
        {collides ? <Note tone="caution">{tt("viewNameOverwrite", { name: d.name.trim() })}</Note> : null}
      </form>
    </KitDialog>
  );
}
