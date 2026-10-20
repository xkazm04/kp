"use client";

// The comparison the world draws. Live: GET /api/analyze/cohort/[id], read again every
// COHORT_POLL_MS while the cohort is queued or running (shouldPollCohort), stopped on done /
// failed, on a 404, after COHORT_POLL_FAILURE_LIMIT transient failures in a row, and on
// unmount. Fixture: the engine's committed output (loadCohortFixture), read once. A later read
// never blanks the view: members land into the one already drawn, so the world does not reflow.
import { useCallback, useEffect, useState } from "react";
import type { CohortView } from "./cohortTypes";
import { fetchCohortView, type ApiFailure } from "./cohortStudioApi";
import { COHORT_POLL_MS, shouldPollCohort } from "./cohortShell";
import { loadCohortFixture } from "./fixture/loadCohortFixture";

export type CohortViewSource = { kind: "fixture"; mode: "done" | "running" } | { kind: "live"; cohortId: string };

export function useCohortView(source: CohortViewSource) {
  const cohortId = source.kind === "live" ? source.cohortId : null;
  const mode = source.kind === "fixture" ? source.mode : null;
  const key = cohortId !== null ? `live:${cohortId}` : `fixture:${mode}`;
  const [view, setView] = useState<{ key: string; view: CohortView } | null>(null);
  const [failure, setFailure] = useState<{ key: string; failure: ApiFailure; stopped: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (mode !== null) {
      let live = true;
      loadCohortFixture(mode)
        .then((v) => {
          if (live) setView({ key, view: v });
        })
        .catch(() => {
          /* a dev aid: a missing fixture leaves the stage on its quiet gap, never an error page */
        });
      return () => {
        live = false;
      };
    }
    if (cohortId === null) return;
    const controller = new AbortController();
    let timer: number | undefined;
    let failures = 0;
    const tick = async () => {
      let status: CohortView["status"] | null = null;
      let notFound = false;
      try {
        const r = await fetchCohortView(fetch, cohortId, controller.signal);
        if (controller.signal.aborted) return;
        if (r.ok) {
          failures = 0;
          status = r.data.status;
          setView({ key, view: r.data });
          setFailure(null);
        } else {
          failures += 1;
          notFound = r.failure.status === 404;
          const stopped = !shouldPollCohort({ status: null, notFound, failures });
          setFailure({ key, failure: r.failure, stopped });
        }
      } catch {
        /* AbortError: this source was left (unmount, another cohort) — nothing to report */
        return;
      }
      if (shouldPollCohort({ status, notFound, failures }) && !controller.signal.aborted) {
        timer = window.setTimeout(tick, COHORT_POLL_MS);
      }
    };
    void tick();
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
    // `attempt` is the manual retry after the poll gave up.
  }, [key, mode, cohortId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return {
    view: view?.key === key ? view.view : null,
    failure: failure?.key === key ? failure : null,
    retry,
  };
}
