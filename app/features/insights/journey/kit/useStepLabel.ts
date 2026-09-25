"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import type { KitStep } from "./journeyKitSteps";

/** A step's name. Five are the cohort layer's own stage words (journey.cohort.stage.*), so both
 *  levels of the overlay name a stage the same way; the analysis and the case are the lane board's. */
export function useStepLabel(): (step: KitStep) => string {
  const t = useTranslations("journey");
  return useCallback(
    (step: KitStep) => {
      switch (step) {
        case "analysed": return t("kit.steps.analysed");
        case "case": return t("kit.steps.case");
        case "source": return t("cohort.stage.source");
        case "screen": return t("cohort.stage.screen");
        case "interview": return t("cohort.stage.interview");
        case "offer": return t("cohort.stage.offer");
        case "onboard": return t("cohort.stage.onboard");
      }
    },
    [t]
  );
}
