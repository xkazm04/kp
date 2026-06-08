"use client";

import { useEffect, useState } from "react";
import type { Job, Stats } from "./JobsTypes";

// The filter bar + debounced corpus fetch in one place. The fetch is driven
// entirely by the filter values, so they live together: every filter change
// re-runs the query after a 180ms debounce, the in-flight request is cancelled
// on the next change/unmount, and `fetching` flags a background refetch while
// the previous results stay on screen. JobsTab consumes this and stays layout.
export function useJobsList() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);

  const [roleFamily, setRoleFamily] = useState("");
  const [seniority, setSeniority] = useState("");
  const [workMode, setWorkMode] = useState("");
  const [entryOnly, setEntryOnly] = useState(false);
  const [q, setQ] = useState("");
  // Bumped to force a re-fetch with the current filters unchanged — e.g. after a
  // new job is ingested into the catalog from the same screen.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (roleFamily) params.set("roleFamily", roleFamily);
    if (seniority) params.set("seniority", seniority);
    if (workMode) params.set("workMode", workMode);
    if (entryOnly) params.set("entryEligible", "true");
    if (q.trim()) params.set("q", q.trim());
    const handle = setTimeout(() => {
      setFetching(true);
      setError(null);
      fetch(`/api/jobs?${params.toString()}`)
        .then(async (r) => {
          if (!r.ok) throw new Error(`Load failed (${r.status}).`);
          return r.json();
        })
        .then((payload) => {
          if (cancelled) return;
          setJobs((payload.jobs as Job[]) ?? []);
          setStats((payload.stats as Stats) ?? null);
        })
        .catch((caught) => {
          if (cancelled) return;
          setError(caught instanceof Error ? caught.message : "Load failed.");
        })
        .finally(() => {
          if (!cancelled) setFetching(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [roleFamily, seniority, workMode, entryOnly, q, reloadKey]);

  const anyFilter = Boolean(roleFamily || seniority || workMode || entryOnly || q.trim());
  const clearAll = () => {
    setRoleFamily("");
    setSeniority("");
    setWorkMode("");
    setEntryOnly(false);
    setQ("");
  };

  return {
    jobs,
    stats,
    error,
    fetching,
    roleFamily,
    setRoleFamily,
    seniority,
    setSeniority,
    workMode,
    setWorkMode,
    entryOnly,
    setEntryOnly,
    q,
    setQ,
    anyFilter,
    clearAll,
    reload: () => setReloadKey((k) => k + 1),
  };
}
