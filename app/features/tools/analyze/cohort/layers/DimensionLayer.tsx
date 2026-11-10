"use client";

// The nested dimension layer: what the Line-up world descends into. The operator picks how the
// dimension explains itself — the overview pages, or one of four structures that say WHY each
// score sits where it does (ledger, anatomy, head-to-head, criteria matrix). The pick persists per
// browser (usePersistedChoice, the key ?layer= also writes). Which structure wins, and whether the
// others go, is the owner's call; until then all five stay and the default is DEFAULT_LAYER.
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { usePersistedChoice } from "@/app/features/hiring/pipeline/orbit/usePersistedChoice";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { DimensionPage } from "../dimensions/DimensionPage";
import { LAYER_STORAGE_KEY } from "../cohortShell";
import { COHORT_LAYERS, isCohortLayer, type CohortLayer, type DimensionLayerProps } from "../cohortTypes";

const quiet = () => <LoadingGap className="min-h-[16rem]" />;
const STRUCTURES: Record<Exclude<CohortLayer, "pages">, React.ComponentType<DimensionLayerProps>> = {
  ledger: dynamic(() => import("./ledger/LedgerLayer").then((m) => ({ default: m.LedgerLayer })), { loading: quiet }),
  anatomy: dynamic(() => import("./anatomy/AnatomyLayer").then((m) => ({ default: m.AnatomyLayer })), { loading: quiet }),
  headToHead: dynamic(() => import("./headToHead/HeadToHeadLayer").then((m) => ({ default: m.HeadToHeadLayer })), { loading: quiet }),
  matrix: dynamic(() => import("./matrix/MatrixLayer").then((m) => ({ default: m.MatrixLayer })), { loading: quiet }),
};

/**
 * The ledger: every row says why its number is what it is, on all seven dimensions — fit
 * included, which has no point anatomy (the anatomy layer can only say so there).
 */
export const DEFAULT_LAYER: CohortLayer = "ledger";

export function DimensionLayer(props: DimensionLayerProps) {
  const t = useTranslations("analyzeCohort.layers");
  const [layer, setLayer] = usePersistedChoice<CohortLayer>(LAYER_STORAGE_KEY, isCohortLayer, DEFAULT_LAYER);
  const Structure = layer === "pages" ? null : STRUCTURES[layer];
  return (
    <div className="space-y-4" data-cohort-layer-host={layer}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={META_LABEL} aria-hidden>
          {t("label")}
        </span>
        <SegmentedControl<CohortLayer>
          label={t("label")}
          options={COHORT_LAYERS.map((id) => ({ value: id, label: t(id) }))}
          value={layer}
          onChange={setLayer}
        />
      </div>
      {Structure ? <Structure {...props} /> : <DimensionPage {...props} />}
    </div>
  );
}
