"use client";

// Starting a comparison (POST /api/analyze/cohort) and what the run sheet may say about its
// cost. Units are named only where this install is KNOWN to meter AI work (GET /api/billing
// `metered`, the same predicate the Billing tab reads); unknown or unmetered says CVs only.
import { useCallback, useEffect, useRef, useState } from "react";
import type { CohortRunRequest } from "./cohortTypes";
import { fetchMetered, startCohort, type ApiFailure } from "./cohortStudioApi";

export function useCohortRun(onStarted: (cohortId: string, request: CohortRunRequest) => void) {
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const busy = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const start = useCallback(
    async (request: CohortRunRequest) => {
      // One start per press: a double click must not spend twice.
      if (busy.current) return;
      busy.current = true;
      setStarting(true);
      setFailure(null);
      try {
        const r = await startCohort(fetch, request);
        if (!live.current) return;
        if (r.ok) onStarted(r.data.cohortId, request);
        else setFailure(r.failure);
      } catch {
        // startCohort rethrows only an abort, and nothing aborts a start; a failure here is a
        // network fault the sheet reports like any other uncoded failure.
        if (live.current) setFailure({ code: null, values: {}, status: 0 });
      } finally {
        busy.current = false;
        if (live.current) setStarting(false);
      }
    },
    [onStarted]
  );

  return { start, starting, failure };
}

/** true / false from the billing overview; null while unread or when it cannot be read.
 *  `enabled` false (the walkthrough spends nothing): never read, so it stays null. */
export function useCohortMetered(enabled = true): boolean | null {
  const [metered, setMetered] = useState<boolean | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetchMetered(fetch, controller.signal)
      .then((m) => {
        if (!controller.signal.aborted) setMetered(m);
      })
      .catch(() => {
        /* AbortError on unmount: the sheet is gone */
      });
    return () => controller.abort();
  }, [enabled]);
  return enabled ? metered : null;
}
