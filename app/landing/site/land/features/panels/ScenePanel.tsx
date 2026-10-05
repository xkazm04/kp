"use client";

import type { ComponentType } from "react";
import { useTranslations } from "next-intl";
import type { Feature, FeatureKey } from "../featureData";
import GatesPanel from "./GatesPanel";
import InboxPanel from "./InboxPanel";
import OfferPanel from "./OfferPanel";
import { RediscoverPanel, SchedulePanel, ScorePanel } from "./OwnPanels";
import SalaryPanel from "./SalaryPanel";
import VoicePanel from "./VoicePanel";
import WorkPanel from "./WorkPanel";

/*
 * The scene's right-hand panel for one feature (prototype app.js paintMock):
 * six features show the console variant's component (scene view, or its detail
 * view under "Look closer") with the "stylised illustration" caption under it;
 * the other three keep B/1's own panel, captioned inside, unchanged by Look
 * closer. The caller keys this by feature and level, so every change remounts
 * the panel: entrance replayed, timers of the old one cleared, state reset.
 */
const CONSOLE: Partial<Record<FeatureKey, ComponentType<{ detail: boolean }>>> = {
  inbox: InboxPanel,
  voice: VoicePanel,
  cases: WorkPanel,
  salary: SalaryPanel,
  offer: OfferPanel,
  gates: GatesPanel
};

const OWN: Partial<Record<FeatureKey, ComponentType>> = {
  score: ScorePanel,
  rediscover: RediscoverPanel,
  schedule: SchedulePanel
};

export function ScenePanel({ feature, detail }: { feature: Feature; detail: boolean }) {
  const t = useTranslations("siteFeatures");
  const Console = feature.console ? CONSOLE[feature.key] : undefined;
  if (Console) {
    return (
      <>
        <Console detail={detail} />
        <p className="m-cap">{t("scene.caption")}</p>
      </>
    );
  }
  const Own = OWN[feature.key];
  return Own ? <Own /> : null;
}
