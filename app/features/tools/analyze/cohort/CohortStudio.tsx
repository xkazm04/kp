"use client";

// Cohort Studio (spark analyze-v2-cohort): Analyze's "new" pane, and the product's Analyze. Role
// first: pick a JD, kp proposes up to COHORT_CAP candidates, the run compares them in the Line-up
// world. The URL inbox (useCohortInbox) takes ?jd=, ?layer= and, in dev, ?cohortFixture=; a
// legacy ?variant= is consumed and dropped. In dev a data switch also offers the engine's
// committed fixtures and the keyless walkthrough (nothing fetched from the install, nothing
// written); production is always the live flow.
import dynamic from "next/dynamic";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { CohortDataSwitch } from "./CohortDataSwitch";
import { CohortFixtureStage } from "./CohortFixtureStage";
import { CohortFlow } from "./CohortFlow";
import { PROTOTYPES_ON, useCohortInbox } from "./useCohortInbox";
import "./cohortStudio.css";

const CohortWalkthrough = dynamic(() => import("./CohortWalkthrough").then((m) => ({ default: m.CohortWalkthrough })), {
  loading: () => <LoadingGap className="min-h-[24rem]" />,
});

export function CohortStudio() {
  const { fixture, setFixture, deepJd } = useCohortInbox();
  return (
    <div className="cs-studio space-y-6" data-cohort-studio={fixture}>
      {PROTOTYPES_ON ? <CohortDataSwitch fixture={fixture} onFixture={setFixture} /> : null}
      {fixture === "live" ? (
        <CohortFlow deepJd={deepJd} />
      ) : fixture === "walkthrough" ? (
        <CohortWalkthrough />
      ) : (
        <CohortFixtureStage mode={fixture} />
      )}
    </div>
  );
}
