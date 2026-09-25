"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { KitSurface } from "@/app/_components/kit";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { useSetupUnfinished } from "@/app/features/shell/setup/useSetupUnfinished";
import { requestOnboardingReopen } from "@/app/features/shell/setup/onboardingReopen";
import { PipelineEmptyState } from "../empty/PipelineEmptyState";
import { usePipelineTabState } from "../usePipelineTabState";
import { usePipelineKit } from "./usePipelineKit";
import { PipelineKitHead } from "./PipelineKitHead";
import { PipelineKitSieve } from "./PipelineKitSieve";
import { PipelineKitSkyline } from "./PipelineKitSkyline";
import { PipelineKitList } from "./PipelineKitList";
import { PipelineKitPane } from "./PipelineKitPane";
import { PipelineKitSla } from "./PipelineKitSla";
import { PipelineKitOffBoard } from "./PipelineKitOffBoard";
import { PipelineKitToday } from "./PipelineKitToday";
import { PipelineKitActivity } from "./PipelineKitActivity";
import { PipelineKitViewDialog } from "./PipelineKitViewDialog";
import { useKitFilters } from "./useKitFilters";

// The full candidate record stays one click away from the pane, split out of the tab chunk: most
// visits never open it.
const CandidateModal = dynamic(() => import("../candidate/CandidateModal").then((m) => ({ default: m.CandidateModal })), {
  loading: () => <LoadingGap className="fixed inset-0 z-50 bg-scrim" />,
});

/*
 * The Hiring pipeline rendered from the composition kit (promoted at Gate K2). The winner's
 * surface, top to bottom: the page head, a toolbar, the Sieve (every candidate a dot, poured through
 * the workspace's stages), the match Skyline (brushable into the sieve and the list), and the windowed
 * list; a row opens the reading pane. It reads the tab state usePipelineTabState holds.
 *
 * A workspace with nobody on the board gets the first-run stage set (empty/PipelineEmptyState.tsx)
 * under the head instead of three empty parts: it is the only door back into the setup wizard for
 * an operator who left it early, and the guided tour's start.
 */
export function PipelineKitView() {
  const f = useKitFilters();
  const s = usePipelineTabState({ scope: f.scope });
  const k = usePipelineKit(s, f);
  const [slaOpen, setSlaOpen] = useState(false);
  const t = useTranslations("pipeline.kit");
  const status = s.error ? "error" : s.entries == null ? "loading" : "ready";
  const setupUnfinished = useSetupUnfinished();
  const empty = status === "ready" && s.entries?.length === 0;

  return (
    <>
      <KitSurface
        pane={k.open ? <PipelineKitPane s={s} k={k} entry={k.open} onOpenRecord={() => k.open && s.openCandidate(k.open, null, "overview")} /> : null}
        onStep={k.step}
        onClose={() => k.select(null)}
      >
        {/* data-sim: the guided walk's "hired" chapter spotlights the board (shell/simulation/simWalkSteps.ts). */}
        <div aria-busy={status === "loading"} aria-label={t("surfaceAria")} role="region" data-sim="pipeline-board">
          <PipelineKitHead s={s} k={k} status={status} />
          {empty ? (
            <PipelineEmptyState
              axis={s.axis}
              setupUnfinished={setupUnfinished}
              onResumeSetup={requestOnboardingReopen}
              onStartTour={s.sim.running ? undefined : s.sim.start}
            />
          ) : (
            <>
              <PipelineKitToday s={s} k={k} />
              <PipelineKitOffBoard s={s} />
              <PipelineKitSieve s={s} k={k} status={status} />
              <PipelineKitSkyline k={k} status={status} />
              <PipelineKitList s={s} k={k} status={status} onEditSla={() => setSlaOpen(true)} />
              <PipelineKitActivity s={s} />
            </>
          )}
        </div>
      </KitSurface>
      <PipelineKitViewDialog s={s} />
      {slaOpen ? <PipelineKitSla s={s} onClose={() => setSlaOpen(false)} /> : null}
      {s.candidate ? (
        <CandidateModal
          key="candidate-modal"
          view={s.candidate}
          // The modal's prev / next walks the kit list's CURRENT order (its filters, layer and sort).
          boardCohort={k.rows}
          axis={s.axis}
          onClose={s.closeCandidate}
          onChanged={s.load}
          onOpenEntry={s.openEntryById}
          onOpenProfile={s.openProfile}
          onNavigate={s.showCandidate}
          onTab={s.setCandidateTab}
        />
      ) : null}
    </>
  );
}
