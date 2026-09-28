"use client";

import { useEffect, useState } from "react";
import type { OrbitJob } from "./orbitModel";

/** The job list read the orbit needs beyond the board payload (the same window the Channels tab reads). */
const JOBS_URL = "/api/jobs?limit=500";

export type OrbitJobs = { jobs: OrbitJob[] | null; failed: boolean; truncated: boolean };

/**
 * The roles the entries do not describe: location, seniority, status and target, and the open roles
 * nobody is on yet (the orbit's rim). A failed read leaves `jobs` null and says so: the orbit still
 * draws every person from the board payload, it just cannot group by city or seniority, or show the
 * empty roles, and the page states that instead of drawing an orbit that looks complete.
 */
export function useOrbitJobs(): OrbitJobs {
  const [state, setState] = useState<OrbitJobs>({ jobs: null, failed: false, truncated: false });
  useEffect(() => {
    const ctl = new AbortController();
    fetch(JOBS_URL, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((p: { jobs?: OrbitJob[]; truncated?: boolean }) => {
        if (!ctl.signal.aborted) setState({ jobs: Array.isArray(p.jobs) ? p.jobs : [], failed: !Array.isArray(p.jobs), truncated: Boolean(p.truncated) });
      })
      .catch(() => {
        if (!ctl.signal.aborted) setState({ jobs: null, failed: true, truncated: false });
      });
    return () => ctl.abort();
  }, []);
  return state;
}
