"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { Job, Stats } from "./JobsTypes";
import { jsonFetchFailure, type JsonFetchFailure } from "@/app/_lib/useJsonFetch";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { mergeJobStatus, type JobLifecycleStatus } from "./jobsStatusMerge";
import { roleStatusOf } from "./jobsRoleStatus";

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
  // The Status column's filter. CLIENT-side, unlike every other filter on this
  // table, and deliberately so: "filled" is not a fact the jobs query can express —
  // it is the role's target compared against the PIPELINE's hired count, which lives
  // in another table on another axis. Asking the server for it would mean either a
  // join the browse read does not have or a second, private definition of "filled"
  // that could disagree with the badge in the row. So the predicate runs here, over
  // the page the query returned, from the same `roleStatusOf` the badge draws.
  const [roleStatus, setRoleStatusState] = useState("");
  // Open-for-applications only (NULL/'published' status) — hides drafts and
  // closed roles. Default ON since the 2026-09 split: the Roles tab is the desk of
  // open and historical roles, and the open ones are what a recruiter works; the
  // history is one toggle away (an ingest clears it so the new draft can surface).
  const [openOnly, setOpenOnlyState] = useState(true);
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
  const setRoleStatus = resetPage(setRoleStatusState);
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
    // `entryOnly` is pinned false here, not dropped from the query mapping: the
    // route still supports `entryEligible` (the JD library and the analytics pack
    // read it) and jobsListQuery is its one definition. What went away is the
    // CONTROL — the Entry column it lived in is now the Status column, and a filter
    // with no way to turn it on is not a filter.
    const query = jobsListQuery({ roleFamily, seniority, workMode, entryOnly: false, openOnly, q });
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
  }, [roleFamily, seniority, workMode, openOnly, q, reloadKey]);

  const anyFilter = Boolean(roleFamily || seniority || workMode || roleStatus || openOnly || q.trim());
  const clearAll = () => {
    setRoleFamilyState("");
    setSeniorityState("");
    setWorkModeState("");
    setRoleStatusState("");
    setOpenOnlyState(false);
    setQState("");
    setPageIndex(0);
  };

  // The rows the TABLE renders: the server's answer narrowed by the one client-side
  // predicate. `allJobs` below stays the unnarrowed answer, because the deep-link
  // resolver (?job=) must find a role the reader has filtered out of view — hiding
  // it would turn a valid link into "that role no longer exists".
  const visible = jobs === null || !roleStatus ? jobs : jobs.filter((job) => roleStatusOf(job) === roleStatus);

  return {
    jobs: visible,
    allJobs: jobs,
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
    roleStatus,
    setRoleStatus,
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
