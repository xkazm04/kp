"use client";

// views-earn-their-name — the save/rename dialog for a saved board view (the
// app's Modal idiom, replacing window.prompt). Split out of PipelineTab.tsx.

import type { PipelineTabTranslator } from "./pipelineTranslator";
import { Modal } from "@/app/_components/Modal";
import { Checkbox } from "@/app/_components/Checkbox";
import { TextInput } from "@/app/_components/TextInput";
import { BTN_GHOST, BTN_PRIMARY } from "@/app/_components/ui/recipes";
import type { SavedView } from "./pipelineBoardFilters";
import { nameCollides } from "./pipelineViews";

export type ViewDialogState =
  | { mode: "save"; name: string; asDefault: boolean }
  | { mode: "rename"; id: string; name: string };

export function PipelineViewDialog({
  t,
  dialog,
  onChange,
  onClose,
  onCommit,
  views,
}: {
  t: PipelineTabTranslator;
  dialog: ViewDialogState;
  onChange: (next: ViewDialogState) => void;
  onClose: () => void;
  onCommit: () => void;
  views: SavedView[];
}) {
  return (
    <Modal
      title={dialog.mode === "rename" ? t("renameViewModalTitle") : t("saveViewModalTitle")}
      subtitle={dialog.mode === "rename" ? t("renameViewModalSubtitle") : t("saveViewModalSubtitle")}
      size="md"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={`${BTN_GHOST} px-3 py-1.5 text-sm`} onClick={onClose}>
            {t("viewDialogCancel")}
          </button>
          <button
            type="button"
            className={`${BTN_PRIMARY} px-3 py-1.5 text-sm`}
            disabled={!dialog.name.trim()}
            onClick={onCommit}
          >
            {dialog.mode === "rename" ? t("renameViewSubmit") : t("saveViewSubmit")}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onCommit();
        }}
        className="flex flex-col gap-3"
      >
        <label className="flex flex-col gap-1 text-sm font-medium text-ink">
          {t("viewNameLabel")}
          <TextInput
            value={dialog.name}
            autoFocus
            maxLength={60}
            placeholder={t("viewNamePlaceholder")}
            onChange={(e) => onChange({ ...dialog, name: e.target.value })}
          />
        </label>
        {dialog.mode === "save" ? (
          <Checkbox
            checked={dialog.asDefault}
            onChange={(e) => onChange({ ...dialog, asDefault: e.target.checked })}
            label={t("viewSetDefaultLabel")}
            hint={t("viewSetDefaultHint")}
          />
        ) : null}
        {/* Explicit overwrite warning — a save/rename onto an existing name
            replaces that view, so the recruiter is told before committing. */}
        {nameCollides(views, dialog.name, dialog.mode === "rename" ? dialog.id : undefined) ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-sm text-amber-700">
            {t("viewNameOverwrite", { name: dialog.name.trim() })}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
