"use client";

import { useEffect, useState } from "react";
import type { Job, Stats } from "./JobsTypes";
import { mergeJobStatus, type JobLifecycleStatus } from "./jobsStatusMerge";

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

  const [roleFamily, setRoleFamilyState] = useState("");
  const [seniority, setSeniorityState] = useState("");
  const [workMode, setWorkModeState] = useState("");
  const [entryOnly, setEntryOnlyState] = useState(false);
  // Open-for-applications only (NULL/'published' status) — hides drafts and
  // closed roles. Default OFF: the corpus view keeps showing the full catalog
  // unless the recruiter opts in, mirroring entryOnly.
  const [openOnly, setOpenOnlyState] = useState(false);
  const [q, setQState] = useState("");
  // Zero-based page for the shared TablePager. It lives HERE, beside the filters,
  // because every filter change re-cuts the result set: staying on page 3 of a
  // list that just became a different list is disorienting, and clamping alone
  // only catches the case where the list got shorter. Each setter below resets it.
  const [page, setPage] = useState(0);
  const resetPage = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(0);
  };
  const setRoleFamily = resetPage(setRoleFamilyState);
  const setSeniority = resetPage(setSeniorityState);
  const setWorkMode = resetPage(setWorkModeState);
  const setEntryOnly = resetPage(setEntryOnlyState);
  const setOpenOnly = resetPage(setOpenOnlyState);
  const setQ = resetPage(setQState);
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
    if (openOnly) params.set("openOnly", "true");
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
  }, [roleFamily, seniority, workMode, entryOnly, openOnly, q, reloadKey]);

  const anyFilter = Boolean(roleFamily || seniority || workMode || entryOnly || openOnly || q.trim());
  const clearAll = () => {
    setRoleFamilyState("");
    setSeniorityState("");
    setWorkModeState("");
    setEntryOnlyState(false);
    setOpenOnlyState(false);
    setQState("");
    setPage(0);
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
    openOnly,
    setOpenOnly,
    q,
    setQ,
    page,
    setPage,
    anyFilter,
    clearAll,
    reload: () => setReloadKey((k) => k + 1),
    // Optimistically flip one row's lifecycle status so its badge/chips update the
    // instant a publish/close/reopen succeeds; the caller pairs this with reload()
    // to reconcile stats + the openOnly filter against server truth.
    patchJobStatus: (jobId: string, status: JobLifecycleStatus) =>
      setJobs((prev) => mergeJobStatus(prev, jobId, status)),
  };
}
