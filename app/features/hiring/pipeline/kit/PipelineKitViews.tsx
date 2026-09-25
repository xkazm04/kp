"use client";

import { useTranslations } from "next-intl";
import { Button, ChipRow, Toggle, type Chip } from "@/app/_components/kit";
import { ActionLine } from "@/app/_components/kit/ActionLine";
import type { PipelineTabState } from "../usePipelineTabState";

/**
 * Saved views (PIPE3/PIPE5, views-earn-their-name) on the kit: one chip per view (pressed = the view
 * the filters currently match), then the ACTIVE view's own actions (open by default, rename, copy
 * its link, delete) and "Save view" while the filters are narrowed and match no saved view. A view
 * is the URL-synced filter state (search, facets, sort, stage), so applying one rewrites exactly the
 * facets above it. Hidden while there is nothing to show or save.
 */
export function PipelineKitViews({ s }: { s: PipelineTabState }) {
  const t = useTranslations("pipeline.kit");
  const tt = useTranslations("pipeline.tab");
  const active = s.views.find((v) => v.id === s.activeViewId) ?? null;
  const canSave = s.filtering && !s.activeViewId;
  if (!s.views.length && !canSave) return null;

  const chips: Chip[] = s.views.map((v) => ({
    id: v.id,
    label: v.isDefault ? t("viewDefaultLabel", { name: v.name }) : v.name,
    pressed: v.id === s.activeViewId,
    tip: v.isDefault ? tt("defaultViewTitle") : tt("applyView"),
    onPress: () => s.applyView(v),
  }));

  return (
    <ActionLine lead={tt("views")} label={tt("views")}>
      {chips.length ? <ChipRow chips={chips} /> : null}
      {active ? (
        <>
          <span className="k-actline__sep" aria-hidden />
          <span className="k-actline__toggle">
            <Toggle
              on={Boolean(active.isDefault)}
              label={active.isDefault ? tt("unsetDefaultView", { name: active.name }) : tt("setDefaultView", { name: active.name })}
              onChange={() => s.toggleDefaultView(active)}
            />
            {tt("setDefaultViewTitle")}
          </span>
          <Button label={tt("renameViewTitle")} variant="ghost" size="sm" onClick={() => s.openRenameView(active)} />
          <Button
            label={s.copiedViewId === active.id ? tt("viewLinkCopied") : tt("copyViewLinkTitle")}
            tip={tt("copyViewLink", { name: active.name })}
            icon={s.copiedViewId === active.id ? "check" : "copy"}
            variant="ghost"
            size="sm"
            onClick={() => void s.copyViewLink(active)}
          />
          <Button label={tt("deleteView", { name: active.name })} icon="trash" iconOnly variant="ghost" size="sm" onClick={() => s.deleteView(active.id)} />
        </>
      ) : null}
      {canSave ? <Button label={tt("saveView")} icon="plus" variant="ghost" size="sm" onClick={s.openSaveView} /> : null}
    </ActionLine>
  );
}
