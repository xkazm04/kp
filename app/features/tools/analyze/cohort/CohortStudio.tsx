"use client";

// Cohort Studio (spark analyze-v2-cohort): Analyze's "new" pane. URL contract (kept from the
// Director's fixture mount): ?variant=<COHORT_VARIANTS> and ?cohortFixture=live|done|running|walkthrough are
// one-shot inbox params (consumed, then emptied) whose picks persist per browser
// (useCohortVariant). `v1` is the unchanged upload form; any other variant is the role-first
// flow (CohortFlow) drawing its comparison in that world, or, with a fixture picked, the
// engine's committed output in that world, or, in the walkthrough, the role-first flow run on
// fixture data with a simulated run. ?layer=<COHORT_LAYERS> picks the nested layer a descent
// opens (the same one-shot inbox). Production: v1 and live only, no switcher.
import dynamic from "next/dynamic";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { CohortVariantSwitch } from "./CohortVariantSwitch";
import { CohortFixtureStage } from "./CohortFixtureStage";
import { CohortFlow } from "./CohortFlow";
import { PROTOTYPES_ON, useCohortVariant } from "./useCohortVariant";
import "./cohortStudio.css";

const CohortWalkthrough = dynamic(() => import("./CohortWalkthrough").then((m) => ({ default: m.CohortWalkthrough })), {
  loading: () => <LoadingGap className="min-h-[24rem]" />,
});
const AnalyzeTab = dynamic(() => import("../AnalyzeTab").then((m) => ({ default: m.AnalyzeTab })), {
  loading: () => <LoadingGap className="min-h-[24rem]" />,
});

export function CohortStudio() {
  const { variant, fixture, setVariant, setFixture } = useCohortVariant();
  const switcher = PROTOTYPES_ON ? (
    <CohortVariantSwitch variant={variant} fixture={fixture} onVariant={setVariant} onFixture={setFixture} />
  ) : null;

  if (variant === "v1") {
    return (
      <div className="space-y-4">
        {switcher}
        <AnalyzeTab />
      </div>
    );
  }
  return (
    <div className="cs-studio space-y-6" data-cohort-studio={fixture}>
      {switcher}
      {fixture === "live" ? (
        <CohortFlow variant={variant} />
      ) : fixture === "walkthrough" ? (
        <CohortWalkthrough variant={variant} />
      ) : (
        <CohortFixtureStage mode={fixture} variant={variant} />
      )}
    </div>
  );
}
