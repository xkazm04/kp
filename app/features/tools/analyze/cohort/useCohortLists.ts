"use client";

// The studio's two lists: the roles a comparison can be for (GET /api/jds, the same bounded
// library read the v1 picker makes, with the role facts the library route already answers) and
// the recent comparisons (GET /api/analyze/cohort). Each has an honest load state: loading is
// not empty, and a failed read is not an empty list.
import { useCallback, useEffect, useState } from "react";
import { JD_LIBRARY_LIMIT, readJdLibraryPayload, type JdLibraryState } from "../analyzeJdLibraryState";
import type { CohortSummary } from "./cohortTypes";
import { fetchRecentCohorts } from "./cohortStudioApi";

/** One role as the picker shows it: a /api/jds row (the fields this surface reads). */
export interface CohortRole {
  slug: string;
  title: string;
  created_at: string;
  roleFamily?: string | null;
  seniority?: string | null;
  company?: string | null;
  /** CVs already analysed against this JD. */
  analysisCount?: number;
  /** The linked job's pipeline; null = no pipeline yet (an analysis-only JD). */
  pipeline?: { total: number } | null;
}

export function useCohortRoles() {
  const [roles, setRoles] = useState<CohortRole[]>([]);
  const [state, setState] = useState<JdLibraryState>("loading");
  const [truncated, setTruncated] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [seenAttempt, setSeenAttempt] = useState(0);
  if (seenAttempt !== attempt) {
    setSeenAttempt(attempt);
    setState("loading");
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/jds?limit=${JD_LIBRARY_LIMIT}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => {
        if (controller.signal.aborted) return;
        const result = readJdLibraryPayload<CohortRole>(payload);
        setRoles(result.jds);
        setState(result.state);
        setTruncated((payload as { truncated?: unknown } | null)?.truncated === true);
      })
      .catch(() => {
        // An abort is our own cancellation; anything else is a failed read, said as such.
        if (controller.signal.aborted) return;
        setRoles([]);
        setState("failed");
      });
    return () => controller.abort();
  }, [attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { roles, state, truncated, reload };
}

export function useCohortRecent(rev: number) {
  const [list, setList] = useState<CohortSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetchRecentCohorts(fetch, controller.signal)
      .then((r) => {
        if (controller.signal.aborted) return;
        setFailed(!r.ok);
        // A failed re-read keeps the strip it already drew.
        if (r.ok) setList(r.data);
      })
      .catch(() => {
        /* AbortError: a newer read or an unmount owns the strip */
      });
    return () => controller.abort();
  }, [rev, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { list, failed, reload };
}
