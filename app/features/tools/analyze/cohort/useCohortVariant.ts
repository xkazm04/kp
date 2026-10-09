"use client";

// Which world the studio draws (?variant=) and where its comparison comes from
// (?cohortFixture=). Both are ONE-SHOT inbox params (app-structure.md "The URL is their
// inbox"): read on arrival, adopted when valid, the bar emptied at once; the pick persists per
// browser (usePersistedChoice). Production ignores both: the baseline form, live data.
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { buildUrl } from "@/app/features/shell/tabs";
import { useShellNavigate } from "@/app/features/shell/nav/shallow-nav";
import { shouldEmptyInbox } from "@/app/features/shell/nav/urlInbox";
import { usePersistedChoice } from "@/app/features/hiring/pipeline/orbit/usePersistedChoice";
import { isCohortVariant, type CohortVariant } from "./cohortTypes";
import {
  activeFixture,
  activeVariant,
  FIXTURE_KEY,
  isCohortFixtureMode,
  parseFixtureParam,
  parseVariantParam,
  VARIANT_KEY,
  type CohortFixtureMode,
} from "./cohortShell";

export const PROTOTYPES_ON = process.env.NODE_ENV !== "production";

export function useCohortVariant() {
  const search = useSearchParams();
  const shellNav = useShellNavigate();
  const [variant, setVariant] = usePersistedChoice<CohortVariant>(VARIANT_KEY, isCohortVariant, "v1");
  const [fixture, setFixture] = usePersistedChoice<CohortFixtureMode>(FIXTURE_KEY, isCohortFixtureMode, "live");

  const inVariant = search.get("variant");
  const inFixture = search.get("cohortFixture");
  useEffect(() => {
    const v = parseVariantParam(inVariant);
    const f = parseFixtureParam(inFixture);
    if (v) setVariant(v);
    if (f) setFixture(f);
    if (shouldEmptyInbox(inVariant) || shouldEmptyInbox(inFixture)) {
      shellNav.replace(buildUrl({ variant: null, cohortFixture: null }, search.toString()));
    }
  }, [inVariant, inFixture, setVariant, setFixture, shellNav, search]);

  return {
    variant: activeVariant(PROTOTYPES_ON, variant),
    fixture: activeFixture(PROTOTYPES_ON, fixture),
    setVariant,
    setFixture,
  };
}
