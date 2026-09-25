"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Menu } from "@/app/_components/kit/Menu";
import { isAnyModalOpen } from "@/app/_components/useDialogA11y";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import type { PipelineTabState } from "../usePipelineTabState";
import { moveOptions } from "./pipelineKitMoves";

/**
 * "Move to…" for one entry: the kit's replacement for the retired board's drag and its keyboard twin
 * (the bead's right-click / Shift+F10 menu). The kit has no board to drag on, so a move is a pick from
 * this menu, in the reading pane, on the row's act track, or by `m` while the pane is open. The pick
 * goes through the board's own optimistic, CAS-guarded moveEntry, so a refused move rolls back and
 * says why exactly as a refused drop did.
 */
export function PipelineKitMove({ s, entry, where, hotkey = false }: { s: PipelineTabState; entry: Entry; where: "pane" | "row"; hotkey?: boolean }) {
  const tr = useTranslations("pipeline.candidateRow");
  const enumLabel = useEnumLabel();
  const [open, setOpen] = useState(false);
  useMoveKey(hotkey, setOpen);
  // The row's picker sits inside a clickable table row: its clicks (the portalled list's included, since
  // React events bubble through portals) must not also open or toggle the row.
  return (
    <span className="contents" onClick={(e) => e.stopPropagation()}>
      <Menu
        label={where === "row" ? tr("moveToFor", { name: entry.candidateLabel }) : tr("moveTo")}
        look="button"
        quiet={where === "row"}
        icon={where === "row" ? "down" : undefined}
        iconOnly={where === "row"}
        size="sm"
        options={moveOptions(entry.stage, s.axis, (id) => enumLabel("stage", id))}
        onSelect={(to) => void s.moveEntry(entry, to)}
        open={open}
        onOpenChange={setOpen}
      />
    </span>
  );
}

/** `m` opens the open entry's stage picker: bare key, never in a field, never under a dialog. */
function useMoveKey(enabled: boolean, setOpen: (open: boolean) => void) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "m" || e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented || isAnyModalOpen()) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      setOpen(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled, setOpen]);
}
