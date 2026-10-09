"use client";

// Act 3 of the walkthrough: the run the sheet started, simulated. The comparison opens at once
// and members land into it a few at a time (useWalkthroughRun), each as the engine's finished
// fixture drew them; the call sheet hears the status like the live step tells it. Said plainly
// above the world: this is fixture data, nothing was analyzed, spent or saved. When the run is
// done, "start over" goes back to the role.
import { useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { BTN_SECONDARY } from "@/app/_components/ui/recipes";
import type { CohortRunRequest, CohortStatus, CohortVariant, CohortView } from "./cohortTypes";
import { narrativeWithheld, pendingShape, type WalkthroughRun } from "./cohortWalkthroughModel";
import { useWalkthroughRun } from "./useWalkthroughRun";
import { CohortComparison } from "./CohortComparison";

export function CohortWalkthroughCompare({
  done,
  running,
  request,
  variant,
  onStatus,
  onStartOver,
}: {
  done: CohortView;
  running: CohortView;
  request: CohortRunRequest;
  variant: Exclude<CohortVariant, "v1">;
  onStatus: (status: CohortStatus, castCount: number, roleTitle: string) => void;
  onStartOver: () => void;
}) {
  const t = useTranslations("analyzeCohort.shell.walkthrough");
  const reduced = useReducedMotion();
  const run = useMemo<WalkthroughRun>(() => ({ done, pending: pendingShape(running), request }), [done, running, request]);
  const view = useWalkthroughRun(run, reduced);
  const size = view.members.length;
  useEffect(() => onStatus(view.status, size, view.jdTitle), [view.status, size, view.jdTitle, onStatus]);
  const finished = view.status === "done";

  return (
    <div className="space-y-3" data-cohort-walkthrough={view.status}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-steel">{t("simulated")}</p>
        {finished ? (
          <button type="button" onClick={onStartOver} className={`${BTN_SECONDARY} h-9 px-4 text-body`}>
            {t("startOver")}
          </button>
        ) : null}
      </div>
      {finished && narrativeWithheld(run) ? <p className="text-body text-steel">{t("narrativeWithheld")}</p> : null}
      <CohortComparison view={view} variant={variant} />
    </div>
  );
}
