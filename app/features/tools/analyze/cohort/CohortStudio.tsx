"use client";

// Cohort Studio (spark analyze-v2-cohort) — Director's minimal FIXTURE MOUNT.
// It exists so the parallel world builders can observe their worlds on real engine
// output before the studio flow lands; WP3 extends it into the role-first flow and
// must keep this URL contract: ?variant=<COHORT_VARIANTS> and ?cohortFixture=done|running
// are one-shot inbox params (consumed, then emptied) whose picks persist per browser.
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { buildUrl } from "@/app/features/shell/tabs";
import { useShellNavigate } from "@/app/features/shell/nav/shallow-nav";
import { shouldEmptyInbox } from "@/app/features/shell/nav/urlInbox";
import { usePersistedChoice } from "@/app/features/hiring/pipeline/orbit/usePersistedChoice";
import { isCohortVariant, type CohortVariant, type CohortView, type CohortWorldProps } from "./cohortTypes";
import { loadCohortFixture } from "./fixture/loadCohortFixture";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";

const quiet = () => <LoadingGap className="min-h-[24rem]" />;
const AnalyzeTab = dynamic(() => import("../AnalyzeTab").then((m) => ({ default: m.AnalyzeTab })), { loading: quiet });
const WORLDS: Record<Exclude<CohortVariant, "v1">, React.ComponentType<CohortWorldProps>> = {
  lineup: dynamic(() => import("./worlds/lineup/LineupWorld").then((m) => ({ default: m.LineupWorld })), { loading: quiet }),
  loom: dynamic(() => import("./worlds/loom/LoomWorld").then((m) => ({ default: m.LoomWorld })), { loading: quiet }),
  console: dynamic(() => import("./worlds/console/ConsoleWorld").then((m) => ({ default: m.ConsoleWorld })), { loading: quiet }),
};

const FIXTURE_KINDS = ["done", "running"] as const;
type FixtureKind = (typeof FIXTURE_KINDS)[number];
const isFixtureKind = (v: unknown): v is FixtureKind => (FIXTURE_KINDS as readonly unknown[]).includes(v);
const PROTOTYPES_ON = process.env.NODE_ENV !== "production";

export function CohortStudio() {
  const search = useSearchParams();
  const shellNav = useShellNavigate();
  const [variant, setVariant] = usePersistedChoice<CohortVariant>("kp-analyze-variant", isCohortVariant, "v1");
  const [fixture, setFixture] = usePersistedChoice<FixtureKind>("kp-analyze-cohort-fixture", isFixtureKind, "done");
  const [view, setView] = useState<CohortView | null>(null);

  const inVariant = search.get("variant");
  const inFixture = search.get("cohortFixture");
  useEffect(() => {
    if (isCohortVariant(inVariant)) setVariant(inVariant);
    if (isFixtureKind(inFixture)) setFixture(inFixture);
    if (shouldEmptyInbox(inVariant) || shouldEmptyInbox(inFixture)) {
      shellNav.replace(buildUrl({ variant: null, cohortFixture: null }, search.toString()));
    }
  }, [inVariant, inFixture, setVariant, setFixture, shellNav, search]);

  const active: CohortVariant = PROTOTYPES_ON ? variant : "v1";
  useEffect(() => {
    if (active === "v1") return;
    let live = true;
    loadCohortFixture(fixture)
      .then((v) => {
        if (live) setView(v);
      })
      .catch(() => {
        /* the fixture is a dev aid: a missing file leaves the world unmounted, never an error page */
      });
    return () => {
      live = false;
    };
  }, [active, fixture]);

  if (active === "v1") return <AnalyzeTab />;
  const World = WORLDS[active];
  return view ? <World view={view} onOpenReport={(slug) => window.open(`/history/${slug}`, "_blank", "noopener")} /> : quiet();
}
