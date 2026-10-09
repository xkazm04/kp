"use client";

// Which world the studio draws (?variant=) and where its comparison comes from
// (?cohortFixture=). Both are ONE-SHOT inbox params (app-structure.md "The URL is their
// inbox"): read on arrival, adopted when valid, the bar emptied at once; the pick persists per
// browser (usePersistedChoice). Production ignores both: the baseline form, live data.
// ?layer=<COHORT_LAYERS> is a third such param: it picks the nested layer a descent opens, under
// the key the layer switch itself persists (DimensionLayer's LAYER_STORAGE_KEY).
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { buildUrl } from "@/app/features/shell/tabs";
import { useShellNavigate } from "@/app/features/shell/nav/shallow-nav";
import { shouldEmptyInbox } from "@/app/features/shell/nav/urlInbox";
import { usePersistedChoice } from "@/app/features/hiring/pipeline/orbit/usePersistedChoice";
import { isCohortVariant, type CohortVariant } from "./cohortTypes";
import type { CohortLayer } from "./cohortTypes";
import {
  activeFixture,
  activeVariant,
  FIXTURE_KEY,
  isCohortFixtureMode,
  parseFixtureParam,
  parseLayerParam,
  parseVariantParam,
  VARIANT_KEY,
  type CohortFixtureMode,
} from "./cohortShell";

export const PROTOTYPES_ON = process.env.NODE_ENV !== "production";

/**
 * Persist a deep link's layer under the switch's own key. The key is read off the layer module
 * lazily — a static import would pull every dimension page into the studio's chunk for a dev aid
 * — and a storage event tells an already-mounted switch (usePersistedChoice listens for it).
 */
function adoptLayer(layer: CohortLayer): void {
  void import("./layers/DimensionLayer").then(({ LAYER_STORAGE_KEY }) => {
    try {
      window.localStorage.setItem(LAYER_STORAGE_KEY, layer);
    } catch {
      /* storage blocked: the deep link cannot persist; the switch still offers every layer */
    }
    window.dispatchEvent(new StorageEvent("storage", { key: LAYER_STORAGE_KEY }));
  });
}

export function useCohortVariant() {
  const search = useSearchParams();
  const shellNav = useShellNavigate();
  const [variant, setVariant] = usePersistedChoice<CohortVariant>(VARIANT_KEY, isCohortVariant, "v1");
  const [fixture, setFixture] = usePersistedChoice<CohortFixtureMode>(FIXTURE_KEY, isCohortFixtureMode, "live");

  const inVariant = search.get("variant");
  const inFixture = search.get("cohortFixture");
  const inLayer = search.get("layer");
  useEffect(() => {
    const v = parseVariantParam(inVariant);
    const f = parseFixtureParam(inFixture);
    const l = parseLayerParam(inLayer);
    if (v) setVariant(v);
    if (f) setFixture(f);
    if (l && PROTOTYPES_ON) adoptLayer(l);
    if (shouldEmptyInbox(inVariant) || shouldEmptyInbox(inFixture) || shouldEmptyInbox(inLayer)) {
      shellNav.replace(buildUrl({ variant: null, cohortFixture: null, layer: null }, search.toString()));
    }
  }, [inVariant, inFixture, inLayer, setVariant, setFixture, shellNav, search]);

  return {
    variant: activeVariant(PROTOTYPES_ON, variant),
    fixture: activeFixture(PROTOTYPES_ON, fixture),
    setVariant,
    setFixture,
  };
}
