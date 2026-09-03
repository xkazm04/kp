"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { Job, Stats } from "./JobsTypes";
import { jsonFetchFailure, type JsonFetchFailure } from "@/app/_lib/useJsonFetch";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { mergeJobStatus, type JobLifecycleStatus } from "./jobsStatusMerge";

// The filter bar + debounced corpus fetch in one place. The fetch is driven
// entirely by the filter values, so they live together: every filter change
// re-runs the query after a 180ms debounce, the in-flight request is cancelled
// on the next change/unmount, and `fetching` flags a background refetch while
// the previous results stay on screen. JobsTab consumes this and stays layout.
export function useJobsList() {
  const t = useTranslations("jobs.tab");
  // The failure is KEPT as `{ code, status }` and the rendered message derived
  // from it through the `errors` catalog — the same contract useJsonFetch holds.
  // This hook was the one jobs read that bypassed it: it threw `Load failed
  // (500).` in hardcoded English and the tab painted it raw, so a Czech recruiter
  // read an English sentence, and the seed-failure 500 additionally carried an
  // absolute filesystem path into that red box.
  const resolveError = useErrorMessage();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  // The three honesty fields the route has answered since listJobsPage landed and
  // nothing here read: the slice was cut (`truncated`), the unbounded count over
  // the SAME predicate (`matching`), and the page size it was cut at (`limit`).
  const [page, setPage] = useState<{ truncated: boolean; matching: number; limit: number } | null>(null);
  const [failure, setFailure] = useState<JsonFetchFailure | null>(null);
  const [fetching, setFetching] = useState(false);

  const [roleFamily, setRoleFamily] = useState("");
  const [seniority, setSeniority] = useState("");
  const [workMode, setWorkMode] = useState("");
  const [entryOnly, setEntryOnly] = useState(false);
  // Open-for-applications only (NULL/'published' status) — hides drafts and
  // closed roles. Default OFF: the corpus view keeps showing the full catalog
  // unless the recruiter opts in, mirroring entryOnly.
  const [openOnly, setOpenOnly] = useState(false);
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
    if (openOnly) params.set("openOnly", "true");
    if (q.trim()) params.set("q", q.trim());
    const handle = setTimeout(() => {
      setFetching(true);
      setFailure(null);
      fetch(`/api/jobs?${params.toString()}`)
        .then(async (r) => {
          const body = (await r.json().catch(() => null)) as Record<string, unknown> | null;
          if (cancelled) return;
          const f = jsonFetchFailure(r.ok, r.status, body);
          if (f) {
            setFailure(f);
            return;
          }
          const payload = body as {
            jobs?: Job[];
            stats?: Stats;
            truncated?: boolean;
            matching?: number;
            limit?: number;
          };
          setJobs(payload.jobs ?? []);
          setStats(payload.stats ?? null);
          setPage(
            typeof payload.matching === "number" && typeof payload.limit === "number"
              ? { truncated: payload.truncated === true, matching: payload.matching, limit: payload.limit }
              : null
          );
        })
        .catch(() => {
          if (cancelled) return;
          // A transport failure carries no HTTP response: status 0 is the honest
          // "never reached the server", and there is no code to resolve.
          setFailure({ code: null, status: 0 });
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
    setRoleFamily("");
    setSeniority("");
    setWorkMode("");
    setEntryOnly(false);
    setOpenOnly(false);
    setQ("");
  };

  return {
    jobs,
    stats,
    page,
    error: failure ? resolveError({ code: failure.code }, t("loadFailed")) : null,
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
