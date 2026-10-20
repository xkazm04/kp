"use client";

import { useTranslations } from "next-intl";
import { ChipRow, SearchField, Toolbar, type Chip } from "@/app/_components/kit";
import { ShapeMark } from "@/app/_components/kit/graphic";
import type { JourneyKit } from "./useJourneyKit";
import { useStepLabel } from "./useStepLabel";

const LEGEND = ["solid", "half", "ring", "dashed", "none"] as const;

/**
 * The Broadsheet's filters on kit parts: active only, observed rows only, include test runs, the
 * find box (diacritic-folded, journeyFilters.columnMatchesFind), and the stop filter a rail step
 * sets, shown as a pressed chip so it can be cleared from here too. Then the shape legend, once:
 * the tiles below carry provenance by shape, and each tile also names itself in its tip.
 */
export function JourneyKitToolbar({ k }: { k: JourneyKit }) {
  const t = useTranslations("journey");
  const label = useStepLabel();
  const chips: Chip[] = [
    { id: "active", label: t("filters.activeOnly"), pressed: k.filters.activeOnly, onPress: () => k.toggle("activeOnly") },
    { id: "observed", label: t("filters.observedOnly"), pressed: k.observedOnly, onPress: k.toggleObserved },
    { id: "runs", label: t("filters.testRuns"), pressed: k.filters.testRuns, onPress: () => k.toggle("testRuns") },
  ];
  const stop = k.filters.stop;
  if (stop) chips.push({ id: "stop", label: t("kit.stopChip", { step: label(stop) }), pressed: true, onPress: () => k.toggleStop(stop) });

  return (
    <div className="jk-toolbar" data-role="journey-kit-toolbar">
      <Toolbar
        inline
        filters={<ChipRow chips={chips} />}
        search={<SearchField label={t("filters.find")} value={k.filters.find} onChange={k.setFind} />}
      />
      <div className="k-shapes jk-legend">
        {LEGEND.map((shape) => (
          <span key={shape}>
            <ShapeMark shape={shape} tone={shape === "solid" || shape === "half" ? "screened" : undefined} tip={null} />
            {t(`kit.legend.${shape}`)}
          </span>
        ))}
      </div>
    </div>
  );
}
