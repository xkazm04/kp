"use client";

// The walkthrough data mode (DEV ONLY, spark analyze-v2-cohort round 2): how a recruiter gets
// into the comparison — pick the role, shape who is compared, start — shown end to end on
// fixture data. The REAL flow (CohortFlow and its steps) runs against a fixture source
// (CohortWalkthroughContext) instead of the routes: keyless, nothing fetched from the install's
// data, nothing written, always works. Its runs live as long as this stage is mounted.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { BTN_SECONDARY, NOTICE } from "@/app/_components/ui/recipes";
import type { CohortRunRequest, CohortVariant, CohortView } from "./cohortTypes";
import { proposalFor, type WalkthroughFixture } from "./cohortWalkthroughModel";
import { CohortWalkthroughContext, type WalkthroughSource } from "./cohortWalkthroughSource";
import { CohortFlow, type WalkthroughCompare } from "./CohortFlow";
import { CohortWalkthroughCompare } from "./CohortWalkthroughCompare";
import { loadCohortFixture } from "./fixture/loadCohortFixture";
import { loadWalkthroughFixture } from "./fixture/loadWalkthroughFixture";

type Loaded = { fx: WalkthroughFixture; done: CohortView; running: CohortView };
/** Run ids for this visit (module memory): unique per Start, never written anywhere. */
let runSeq = 0;

export function CohortWalkthrough({ variant }: { variant: Exclude<CohortVariant, "v1"> }) {
  const t = useTranslations("analyzeCohort.shell.walkthrough");
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    Promise.all([loadWalkthroughFixture(), loadCohortFixture("done"), loadCohortFixture("running")])
      .then(([fx, done, running]) => {
        if (!live) return;
        setData({ fx, done, running });
        setFailed(false);
      })
      .catch(() => {
        // A dev aid whose static files did not load: said, with a retry, never an error page.
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  // The started runs, by the id the flow's compare step asks for. Written in Start's handler.
  const [runs, setRuns] = useState<Record<string, CohortRunRequest>>({});
  const source = useMemo<WalkthroughSource | null>(
    () =>
      data && {
        roles: data.fx.roles,
        proposalFor: (jdSlug) => proposalFor(data.fx, jdSlug),
        population: data.fx.population,
        start: (request) => {
          runSeq += 1;
          const id = `walkthrough-${runSeq}`;
          setRuns((cur) => ({ ...cur, [id]: request }));
          return id;
        },
      },
    [data]
  );
  const compare = useCallback<WalkthroughCompare>(
    ({ cohortId, onStatus, onStartOver }) => {
      const request = runs[cohortId];
      if (!data || !request) return null;
      return (
        <CohortWalkthroughCompare
          key={cohortId}
          done={data.done}
          running={data.running}
          request={request}
          variant={variant}
          onStatus={onStatus}
          onStartOver={onStartOver}
        />
      );
    },
    [data, runs, variant]
  );

  if (!source) {
    if (failed) {
      return (
        <div role="alert" className={`${NOTICE("critical")} flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-body`}>
          {t("failed")}
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className={`${BTN_SECONDARY} h-9 bg-white px-4 text-body`}>
            {t("retry")}
          </button>
        </div>
      );
    }
    return <LoadingGap className="min-h-[24rem]" label={t("loading")} />;
  }
  return (
    <CohortWalkthroughContext.Provider value={source}>
      <CohortFlow variant={variant} walkthrough={compare} />
    </CohortWalkthroughContext.Provider>
  );
}
