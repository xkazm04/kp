"use client";

// Who the comparison would hold for one role: GET /api/analyze/cohort/proposal?jd=. The
// tray the recruiter edits is seeded from it (trayFromProposal) and owned by the caller.
// Aborted on unmount and on a role change; a failure is reported as its code.
import { useCallback, useEffect, useState } from "react";
import type { CohortProposal } from "./cohortTypes";
import { fetchProposal, type ApiFailure } from "./cohortStudioApi";

export type ProposalState =
  | { state: "loading" }
  | { state: "ready"; proposal: CohortProposal }
  | { state: "failed"; failure: ApiFailure };

export function useCohortProposal(jdSlug: string) {
  const [result, setResult] = useState<{ key: string; value: ProposalState } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${jdSlug}#${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    fetchProposal(fetch, jdSlug, controller.signal)
      .then((r) => {
        if (controller.signal.aborted) return;
        setResult({ key, value: r.ok ? { state: "ready", proposal: r.data } : { state: "failed", failure: r.failure } });
      })
      .catch(() => {
        /* AbortError: the role changed or the studio left — the newer read owns the state */
      });
    return () => controller.abort();
  }, [jdSlug, key]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const value: ProposalState = result?.key === key ? result.value : { state: "loading" };
  return { ...value, reload };
}
