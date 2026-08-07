"use client";

// PIPE3/PIPE5 (views-earn-their-name) — the saved-board-views chip row: apply,
// mark-default (star), rename, copy-link and delete per view. Split out of
// PipelineTab.tsx; the dialog for save/rename lives in PipelineViewDialog.tsx.
//
// Owns its own inset because it renders as a strip inside the board panel, between
// the filter header and the lanes — the one place a saved view belongs, since
// applying one rewrites exactly the facets above it.

import type { PipelineTabTranslator } from "./pipelineTranslator";
import { Link2, Pencil, Star, X } from "lucide-react";
import { Collapse } from "./PipelineMotion";
import type { SavedView } from "./pipelineBoardFilters";

export function PipelineSavedViews({
  t,
  views,
  activeViewId,
  copiedViewId,
  onToggleDefault,
  onApply,
  onRename,
  onCopyLink,
  onDelete,
}: {
  t: PipelineTabTranslator;
  views: SavedView[];
  activeViewId: string | null;
  copiedViewId: string | null;
  onToggleDefault: (v: SavedView) => void;
  onApply: (v: SavedView) => void;
  onRename: (v: SavedView) => void;
  onCopyLink: (v: SavedView) => void;
  onDelete: (id: string) => void;
}) {
  // Self-hiding (no views yet, or the last one just deleted), so the strip owns its
  // own open/close — saving the first view grows the row into the panel instead of
  // shoving the lanes down a notch on one frame. See PipelineMotion.
  return (
    <Collapse show={views.length > 0}>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-stone-200 px-4 py-2">
        <span className="text-meta uppercase tracking-wide text-steel">{t("views")}</span>
        {views.map((v) => {
          const isDefault = Boolean(v.isDefault);
          return (
            <span
              key={v.id}
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-base font-semibold ${
                activeViewId === v.id ? "border-coral bg-coral/10 text-coral" : "border-stone-200 bg-white text-steel"
              }`}
            >
              {/* views-earn-their-name: mark the view that opens on a bare visit.
                  A filled star = the current default; clicking it clears it. */}
              <button
                type="button"
                onClick={() => onToggleDefault(v)}
                aria-pressed={isDefault}
                aria-label={isDefault ? t("unsetDefaultView", { name: v.name }) : t("setDefaultView", { name: v.name })}
                title={isDefault ? t("defaultViewTitle") : t("setDefaultViewTitle")}
                className={`focus-ring -ml-0.5 rounded ${isDefault ? "text-coral" : "text-steel hover:text-ink"}`}
              >
                <Star size={13} fill={isDefault ? "currentColor" : "none"} aria-hidden />
              </button>
              <button type="button" onClick={() => onApply(v)} className="focus-ring rounded hover:text-ink" title={t("applyView")}>
                {v.name}
              </button>
              {/* views-earn-their-name: rename keeps the view's identity (same
                  encoded filters, same default marking — share links unaffected). */}
              <button
                type="button"
                onClick={() => onRename(v)}
                aria-label={t("renameView", { name: v.name })}
                title={t("renameViewTitle")}
                className="focus-ring rounded text-steel hover:text-ink"
              >
                <Pencil size={13} aria-hidden />
              </button>
              {/* PIPE3: the view as a pasteable link — localStorage views
                  can't travel; the URL can. */}
              <button
                type="button"
                onClick={() => onCopyLink(v)}
                aria-label={t("copyViewLink", { name: v.name })}
                title={copiedViewId === v.id ? t("viewLinkCopied") : t("copyViewLinkTitle")}
                className={`focus-ring rounded ${copiedViewId === v.id ? "text-moss" : "text-steel hover:text-ink"}`}
              >
                <Link2 size={13} />
              </button>
              <button
                type="button"
                onClick={() => onDelete(v.id)}
                aria-label={t("deleteView", { name: v.name })}
                title={t("deleteViewTitle")}
                className="focus-ring -mr-0.5 rounded text-steel hover:text-coral"
              >
                <X size={13} />
              </button>
            </span>
          );
        })}
      </div>
    </Collapse>
  );
}
