"use client";

// The nested dimension layer (spark analyze-v2-cohort round 2): what a world descends into.
// During the prototype round it dispatches between the round-1 pages (`pages`, the baseline)
// and four structures that explain WHY each score sits where it does. The pick is a
// per-browser convenience (usePersistedChoice) and the switch is dev-only; production
// renders the baseline pages until the round picks a structure.
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { usePersistedChoice } from "@/app/features/hiring/pipeline/orbit/usePersistedChoice";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { DimensionPage } from "../dimensions/DimensionPage";
import { COHORT_LAYERS, isCohortLayer, type CohortLayer, type DimensionLayerProps } from "../cohortTypes";

const quiet = () => <LoadingGap className="min-h-[16rem]" />;
const STRUCTURES: Record<Exclude<CohortLayer, "pages">, React.ComponentType<DimensionLayerProps>> = {
  ledger: dynamic(() => import("./ledger/LedgerLayer").then((m) => ({ default: m.LedgerLayer })), { loading: quiet }),
  anatomy: dynamic(() => import("./anatomy/AnatomyLayer").then((m) => ({ default: m.AnatomyLayer })), { loading: quiet }),
  headToHead: dynamic(() => import("./headToHead/HeadToHeadLayer").then((m) => ({ default: m.HeadToHeadLayer })), { loading: quiet }),
  matrix: dynamic(() => import("./matrix/MatrixLayer").then((m) => ({ default: m.MatrixLayer })), { loading: quiet }),
};

export const LAYER_STORAGE_KEY = "kp-analyze-layer";
const PROTOTYPES_ON = process.env.NODE_ENV !== "production";

export function DimensionLayer(props: DimensionLayerProps) {
  const t = useTranslations("analyzeCohort.layers");
  const [layer, setLayer] = usePersistedChoice<CohortLayer>(LAYER_STORAGE_KEY, isCohortLayer, "pages");
  const active: CohortLayer = PROTOTYPES_ON ? layer : "pages";
  const Structure = active === "pages" ? null : STRUCTURES[active];
  return (
    <div className="space-y-4" data-cohort-layer-host={active}>
      {PROTOTYPES_ON ? (
        <SegmentedControl<CohortLayer>
          label={t("label")}
          options={COHORT_LAYERS.map((id) => ({ value: id, label: t(id) }))}
          value={active}
          onChange={setLayer}
        />
      ) : null}
      {Structure ? <Structure {...props} /> : <DimensionPage {...props} />}
    </div>
  );
}
