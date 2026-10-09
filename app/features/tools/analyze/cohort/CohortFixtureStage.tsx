"use client";

// A committed fixture drawn in the chosen world (DEV aid: the engine's real output for 20
// members, "done" or caught mid-run). The slate says it is a fixture, so nobody mistakes it for
// a recruiter's comparison.
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import type { CohortVariant } from "./cohortTypes";
import { CohortSlate } from "./CohortSlate";
import { CohortComparison } from "./CohortComparison";
import { useCohortView } from "./useCohortView";

export function CohortFixtureStage({ mode, variant }: { mode: "done" | "running"; variant: Exclude<CohortVariant, "v1"> }) {
  const { view } = useCohortView({ kind: "fixture", mode });
  return (
    <>
      <CohortSlate
        step={{ act: "compare", cohortId: view?.cohortId ?? "fixture", from: null }}
        roleTitle={view?.jdTitle ?? null}
        castCount={view?.members.length ?? null}
        status={view?.status ?? null}
        fixture={mode}
      />
      {view ? <CohortComparison view={view} variant={variant} /> : <LoadingGap className="min-h-[24rem]" />}
    </>
  );
}
