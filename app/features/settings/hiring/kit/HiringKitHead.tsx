"use client";

import { useTranslations } from "next-intl";
import { Button, PageHead, Segmented, Toolbar, type Figure } from "@/app/_components/kit";
import { AXIS_MAX_STAGES } from "@/app/features/shared/pipelineAxisDraft";
import { PRESETS, activePresetId, type PresetAxisLabels, type PresetId } from "../pipelineComposerModel";
import { planFigures, type Composer } from "./hiringKitModel";

const PRESET_KEY: Record<PresetId, "presetLean" | "presetHybrid" | "presetEnterprise"> = {
  lean: "presetLean",
  hybrid: "presetHybrid",
  enterprise: "presetEnterprise",
};

/**
 * The page head (eyebrow, title, the one-line intro, three figures: steps, human decisions, rounds
 * to book, each with its change against the stored plan) with the one primary Save, and the
 * toolbar of presets. A preset rewrites the whole plan (and Enterprise the columns too), exactly as
 * the pre-kit steps table's chips did; nothing is stored until Save.
 */
export function HiringKitHead({ c }: { c: Composer }) {
  const t = useTranslations("hiringPlan");
  const ready = c.plan != null && c.axis != null;
  const figs = c.plan && c.axis ? planFigures(c.plan, c.axis.stages, c.savedPlan, c.savedStages) : null;

  const figures: Figure[] = [
    { label: t("steps.title"), value: c.axis ? c.axis.stages.length : null, of: c.axis ? AXIS_MAX_STAGES : undefined },
    { label: t("impact.touchpointsLabel"), value: figs?.decisions ?? null, delta: figs?.decisionsDelta || undefined },
    { label: t("kit.roundsToBook"), value: figs?.rounds ?? null, delta: figs?.roundsDelta || undefined },
  ];

  // Localized here, never inside the model: a preset must not write English onto a Czech board.
  const presetLabels: PresetAxisLabels = {
    homework: t("presetAxis.homework"),
    aiInterview: t("presetAxis.aiInterview"),
    screened: t("presetAxis.screened"),
    humanInterview: t("presetAxis.humanInterview"),
    offer: t("presetAxis.offer"),
  };
  const applyPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p || !c.plan || !c.axis) return;
    const next = p.axis ? p.axis(c.axis, presetLabels) : null;
    if (next) c.setAxis(next);
    c.setPlan(p.plan(next ? next.stages : c.axis.stages));
  };
  const active = c.plan && c.axis ? activePresetId(c.plan, c.axis.stages) : null;

  return (
    <>
      <PageHead
        eyebrow={t("eyebrow")}
        title={t("title")}
        context={t("intro")}
        figures={figures}
        state={c.loadFailed ? "error" : ready ? "ready" : "loading"}
        errorText={t("loadFailed")}
        actions={
          <>
            {ready && !c.dirty && !c.saving ? (
              <span className="k-acts-note" role="status">
                {t("allSaved")}
              </span>
            ) : null}
            <Button
            label={t("save")}
            variant="primary"
            loading={c.saving}
            loadingLabel={t("saving")}
            disabled={!ready || !c.dirty || c.blocked}
            onClick={() => void c.save()}
            />
          </>
        }
      />
      {ready ? (
        <Toolbar
          segmented={
            <Segmented
              label={t("startFrom")}
              lead={t("startFrom")}
              value={active ?? ""}
              onChange={applyPreset}
              items={PRESETS.map((p) => ({ value: p.id, label: t(PRESET_KEY[p.id]) }))}
            />
          }
        />
      ) : null}
    </>
  );
}
