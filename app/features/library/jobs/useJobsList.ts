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

/** The filter values the corpus query is derived from. Named so the pure pair
 *  below can be driven directly — the hook itself needs a React renderer this
 *  repo does not carry, and the query/payload mapping is the half worth pinning. */
export type JobsListFilters = {
  roleFamily: string;
  seniority: string;
  workMode: string;
  entryOnly: boolean;
  openOnly: boolean;
  q: string;
};

/** Filter values → the `/api/jobs` query string. The wire names differ from the
 *  state names (`entryOnly` → `entryEligible`), a false toggle is ABSENT rather
 *  than `false` (the route reads presence), and a whitespace-only search box is
 *  not a search. */
export function jobsListQuery(filters: JobsListFilters): string {
  const params = new URLSearchParams();
  if (filters.roleFamily) params.set("roleFamily", filters.roleFamily);
  if (filters.seniority) params.set("seniority", filters.seniority);
  if (filters.workMode) params.set("workMode", filters.workMode);
  if (filters.entryOnly) params.set("entryEligible", "true");
  if (filters.openOnly) params.set("openOnly", "true");
  if (filters.q.trim()) params.set("q", filters.q.trim());
  return params.toString();
}

/** The route's three honesty fields, or null when the answer did not carry them.
 *  Null is deliberate: inventing `truncated: false` would be a claim about the
 *  corpus the server never made. */
export type JobsListPage = { truncated: boolean; matching: number; limit: number } | null;

/** Read a `/api/jobs` body into what the tab renders. A missing/non-array `jobs`
 *  is an empty corpus, never `undefined` reaching the table. */
export function readJobsListPayload(body: unknown): { jobs: Job[]; stats: Stats | null; page: JobsListPage } {
  const payload = (body ?? {}) as { jobs?: unknown; stats?: unknown; truncated?: unknown; matching?: unknown; limit?: unknown };
  return {
    jobs: Array.isArray(payload.jobs) ? (payload.jobs as Job[]) : [],
    stats: (payload.stats as Stats | null) ?? null,
    page:
      typeof payload.matching === "number" && typeof payload.limit === "number"
        ? { truncated: payload.truncated === true, matching: payload.matching, limit: payload.limit }
        : null,
  };
}

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

  const [roleFamily, setRoleFamilyState] = useState("");
  const [seniority, setSeniorityState] = useState("");
  const [workMode, setWorkModeState] = useState("");
  const [entryOnly, setEntryOnlyState] = useState(false);
  // Open-for-applications only (NULL/'published' status) — hides drafts and
  // closed roles. Default OFF: the corpus view keeps showing the full catalog
  // unless the recruiter opts in, mirroring entryOnly.
  const [openOnly, setOpenOnlyState] = useState(false);
  const [q, setQState] = useState("");
  // Zero-based index for the shared TablePager. It lives HERE, beside the filters,
  // because every filter change re-cuts the result set: staying on page 3 of a
  // list that just became a different list is disorienting, and clamping alone
  // only catches the case where the list got shorter. Each setter below resets it.
  //
  // Named `pageIndex`, not `page`: `page` is already taken on this hook by the
  // route's honesty triple above (truncated / matching / limit), and the two are
  // different things — "which slice am I looking at" vs "was the server's answer
  // cut". A merge that let both be called `page` compiled as a redeclaration.
  const [pageIndex, setPageIndex] = useState(0);
  const resetPage = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPageIndex(0);
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
    // A REAL cancellation. The header above has claimed one since this hook was
    // written, but the code only flipped a `cancelled` boolean: the socket stayed
    // open, so typing eight characters into the search box left eight live requests
    // racing to the browser's per-host limit, each decoding a full page of jobs
    // nobody would read, and the last one to arrive was not necessarily the last one
    // sent. The controller both frees the connection and doubles as the
    // "does this attempt still own the state?" flag, so there is exactly one
    // cancellation mechanism instead of a boolean beside a comment.
    const controller = new AbortController();
    const query = jobsListQuery({ roleFamily, seniority, workMode, entryOnly, openOnly, q });
    const handle = setTimeout(() => {
      setFetching(true);
      setFailure(null);
      fetch(`/api/jobs?${query}`, { signal: controller.signal })
        .then(async (r) => {
          const body = (await r.json().catch(() => null)) as Record<string, unknown> | null;
          if (controller.signal.aborted) return;
          const f = jsonFetchFailure(r.ok, r.status, body);
          if (f) {
            setFailure(f);
            return;
          }
          const next = readJobsListPayload(body);
          setJobs(next.jobs);
          setStats(next.stats);
          setPage(next.page);
        })
        .catch(() => {
          // An abort is not a failure — the surface is gone or a newer attempt owns
          // the state. Anything else is a transport failure, which carries no HTTP
          // response: status 0 is the honest "never reached the server", and there
          // is no code to resolve.
          if (controller.signal.aborted) return;
          setFailure({ code: null, status: 0 });
        })
        .finally(() => {
          if (!controller.signal.aborted) setFetching(false);
        });
    }, 180);
    return () => {
      // Abort before clearing the timer so a request already in flight is dropped
      // too — clearTimeout alone only stops one that has not started.
      controller.abort();
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
    setPageIndex(0);
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
    pageIndex,
    setPageIndex,
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
