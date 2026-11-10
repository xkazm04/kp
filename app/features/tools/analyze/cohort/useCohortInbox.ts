"use client";

// The studio's URL inbox (app-structure.md "The URL is their inbox"): every param here is read on
// arrival, adopted when valid, and the bar emptied at once.
//   ?jd=<slug>            open the studio on that role's cast step (Library's "Compare candidates for this role").
//   ?layer=<COHORT_LAYERS> the nested layer a descent opens, persisted under the layer control's key.
//   ?cohortFixture=<mode> DEV ONLY: where the comparison comes from (live / done / running /
//                         walkthrough); production is always live.
//   ?variant=             retired with the v1 form: consumed and dropped, so an old link lands on
//                         the studio instead of keeping a dead param in the bar.
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { buildUrl } from "@/app/features/shell/tabs";
import { useShellNavigate } from "@/app/features/shell/nav/shallow-nav";
import { shouldEmptyInbox } from "@/app/features/shell/nav/urlInbox";
import { usePersistedChoice } from "@/app/features/hiring/pipeline/orbit/usePersistedChoice";
import type { CohortLayer } from "./cohortTypes";
import {
  activeFixture,
  FIXTURE_KEY,
  isCohortFixtureMode,
  LAYER_STORAGE_KEY,
  parseFixtureParam,
  parseJdParam,
  parseLayerParam,
  type CohortFixtureMode,
} from "./cohortShell";

/** One ?jd= arrival: the role, and which arrival it was. */
export type DeepJd = { slug: string; seq: number };

export const PROTOTYPES_ON = process.env.NODE_ENV !== "production";

/** Persist a deep link's layer under the control's own key; a storage event tells a mounted control. */
function adoptLayer(layer: CohortLayer): void {
  try {
    window.localStorage.setItem(LAYER_STORAGE_KEY, layer);
  } catch {
    /* storage blocked: the deep link cannot persist; the control still offers every layer */
  }
  window.dispatchEvent(new StorageEvent("storage", { key: LAYER_STORAGE_KEY }));
}

export function useCohortInbox() {
  const search = useSearchParams();
  const shellNav = useShellNavigate();
  const [fixture, setFixture] = usePersistedChoice<CohortFixtureMode>(FIXTURE_KEY, isCohortFixtureMode, "live");
  // A role named by the URL: each ARRIVAL is a new token (seq), so a repeat link to the same
  // role still lands; the flow remembers which token it took. Adopted during render (the
  // seen-value pattern), not in an effect.
  const [deepJd, setDeepJd] = useState<DeepJd | null>(null);
  const [seenJd, setSeenJd] = useState<string | null>(null);

  const inFixture = search.get("cohortFixture");
  const inLayer = search.get("layer");
  const inJd = search.get("jd");
  const inVariant = search.get("variant");
  if (inJd !== seenJd) {
    setSeenJd(inJd);
    const j = parseJdParam(inJd);
    if (j) setDeepJd({ slug: j, seq: (deepJd?.seq ?? 0) + 1 });
  }
  useEffect(() => {
    const f = parseFixtureParam(inFixture);
    const l = parseLayerParam(inLayer);
    if (f && PROTOTYPES_ON) setFixture(f);
    if (l) adoptLayer(l);
    if ([inFixture, inLayer, inJd, inVariant].some(shouldEmptyInbox)) {
      shellNav.replace(buildUrl({ variant: null, cohortFixture: null, layer: null, jd: null }, search.toString()));
    }
  }, [inFixture, inLayer, inJd, inVariant, setFixture, shellNav, search]);

  return { fixture: activeFixture(PROTOTYPES_ON, fixture), setFixture, deepJd };
}
