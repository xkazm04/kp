// Data + derived-state hook for JobsRecruiterCandidates.tsx — extracted verbatim
// (no behaviour change) so the component file stays under the 200-line split
// threshold. Owns: candidate loading (with the latest-request guard + abort),
// fair-rank / pool-fit toggles, the eligible/early-career/experienced partitions,
// the cross-scheme fairness matrix indexing, and the fairness CSV export.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { isEarlyCareer } from "./JobsTypes";
import { fairnessCsvRows, indexFairnessMatrix } from "./jobsFairnessMatrix";
import type { CandRow, FairnessMatrix, SkippedCandidate } from "./JobsTypes";
import { downloadFile, toCsv } from "@/app/_lib/export-utils";
import { FIT_PROMISING_FLOOR } from "@/app/_lib/fit-thresholds";
import { useAddToPipeline } from "@/app/_lib/useAddToPipeline";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useReachOut } from "@/app/_lib/useReachOut";
// bug-ui-scan-2026-07-09 (sourcing-campaigns-rediscovery #3): "latest request wins"
// guard so a slow ranking for a previously-selected role can't clobber the current
// role's list when the posting modal is reused across jobs.
import { makeLatestRequestGuard } from "./jobsRequestGuard";

export function useRecruiterCandidatesLogic({
  jobId,
  jobTitle,
  roleFamily,
  autoLoad = false,
}: {
  jobId: string;
  jobTitle: string;
  roleFamily: string | null;
  autoLoad?: boolean;
}) {
  const t = useTranslations("jobs.candidates");
  // Resolve API failures from the machine `code`, never from the server's
  // English `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  const [data, setData] = useState<{
    candidates: CandRow[];
    skipped?: SkippedCandidate[];
    fairness?: FairnessMatrix | null;
    // Honest cap signal from the route: the corpus exceeds the pool caps
    // (PROFILE_POOL_CAP + ANALYSIS_POOL_CAP), so some saved candidates were never
    // scored here — the overflow is EXCLUDED, not ranked low. Shipped by
    // GET /api/jobs/[id]/candidates since the caps landed and unread until now, so
    // an over-cap workspace saw a ranking, a KO count and a Pool-Fit count all
    // computed over a subset with no notice — the same cut-slice-as-whole-set shape
    // the rediscovery panel closed with its "+N more" line.
    poolTruncated?: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // e1e4e0ea — when on, rank by the robust cross-scheme mean instead of each
  // candidate's own-weight score, and surface the own-vs-robust delta.
  const [fairRank, setFairRank] = useState(false);
  // Pool Fit (internal-mobility analog): filter the ranked pool to strong matches
  // who AREN'T in the pipeline yet — the actionable "who should I source for this
  // role" subset, distinct from silver-medalist alerts (candidate-across-roles).
  const [poolFitOnly, setPoolFitOnly] = useState(false);
  // The jobId whose candidates are currently loaded — so auto-load fires once per job
  // (mount AND when the reused modal switches jobs), not just on first mount.
  const loadedJobRef = useRef<string | null>(null);
  // bug-ui-scan-2026-07-09 (sourcing-campaigns-rediscovery #3): loadedJobRef only gates
  // INITIATION; these gate late RESOLUTION. The guard drops a stale response (keyed by
  // jobId) and the AbortController cancels the prior in-flight fetch — which SIGKILLs
  // its orphaned recruiter_cli child — so switching roles can't leave the wrong role's
  // ranked pool on screen.
  const guardRef = useRef(makeLatestRequestGuard());
  const abortRef = useRef<AbortController | null>(null);
  const { add, added, adding, error: cardError, announce } = useAddToPipeline(jobId, jobTitle, "sourcing");
  const { reach, reached, reaching, error: reachError, announce: reachAnnounce } = useReachOut(jobId, "sourcing");

  const load = async () => {
    // bug-ui-scan-2026-07-09 (sourcing-campaigns-rediscovery #3): capture the jobId as
    // the request key, abort any prior fetch, and re-check the key before every state
    // write so only the current role's result lands.
    const key = jobId;
    guardRef.current.begin(key);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/candidates`, { signal: controller.signal });
      const payload = await r.json();
      if (!guardRef.current.isCurrent(key)) return; // a newer role's load superseded this one
      if (!r.ok) throw new Error(errMsg(payload, t("failedStatus", { status: r.status })));
      setData(payload);
    } catch (caught) {
      // A superseded or aborted request must never surface an error over the current role.
      if (controller.signal.aborted || !guardRef.current.isCurrent(key)) return;
      setError(caught instanceof Error ? caught.message : t("failed"));
    } finally {
      if (guardRef.current.isCurrent(key)) setLoading(false);
    }
  };

  // Cancel any in-flight ranking when the modal unmounts — drops the stale response
  // and SIGKILLs the orphaned CLI child instead of a setState-after-unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Deferred kick-off (0 ms timer): load() flips the loading flag synchronously,
  // and a sync setState in the effect body would cascade a render before the
  // first commit settles. The guard runs inside the tick with the values it
  // captured at effect time — the same read the original synchronous check made.
  useEffect(() => {
    if (!autoLoad) return;
    const timer = window.setTimeout(() => {
      // Fire once per jobId: on mount AND when the reused modal switches jobs (the old
      // `!data` guard kept showing the previous job's candidates because data was non-null).
      if (loadedJobRef.current !== jobId && !loading) {
        loadedJobRef.current = jobId;
        load();
      }
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad, jobId]);

  // Stable handler identities. Both are passed down to the memoized card, whose
  // boundary an arrow re-created on every render would silently erase — the memo
  // would still be there and would never hold.
  const candidateInput = useCallback(
    (c: CandRow) => ({
      candidateId: c.candidateId,
      candidateLabel: c.label,
      archetype: c.archetype,
      matchScore: c.result.total,
      roleFamily,
    }),
    [roleFamily]
  );
  const addToPipeline = useCallback((c: CandRow) => add(candidateInput(c)), [add, candidateInput]);
  const reachOut = useCallback((c: CandRow) => reach(candidateInput(c)), [reach, candidateInput]);

  // ONE pass over the payload for every cohort this surface shows. These were six
  // separate render-body filters (eligible → pool-fit → shown → early/experienced →
  // not-eligible), each walking the whole ranked pool, re-run on every add, every
  // reach-out, every toggle and every keystroke in the modal above. They depend on
  // exactly two things: the payload and the pool-fit toggle.
  const cohorts = useMemo(() => {
    const all = data?.candidates ?? [];
    const eligible = all.filter((c) => c.koPassed);
    // A "pool fit" = eligible, promising (≥ the rediscover SCORE_FLOOR), and NOT yet
    // in this role's pipeline — the strong matches sitting unused in the pool. Shares
    // the exact rediscovery admission floor via fit-thresholds.ts, so tuning one
    // surface can't silently drift from the other (sourcing-campaigns-rediscovery #3).
    const isPoolFit = (c: CandRow) => !c.inPipeline && c.result.total >= FIT_PROMISING_FLOOR;
    const poolFit = eligible.filter(isPoolFit);
    // When the filter is on, both columns narrow to the pool-fit subset.
    const shown = poolFitOnly ? poolFit : eligible;
    return {
      eligible,
      poolFitCount: poolFit.length,
      earlyCareer: shown.filter((c) => isEarlyCareer(c.archetype)),
      experienced: shown.filter((c) => !isEarlyCareer(c.archetype)),
      notEligibleRows: all.filter((c) => !c.koPassed),
    };
  }, [data, poolFitOnly]);
  const { eligible, poolFitCount, earlyCareer, experienced, notEligibleRows } = cohorts;
  const notEligible = notEligibleRows.length;
  const skipped = data?.skipped ?? [];
  // Strictly `=== true`: an older/partial payload without the flag reads as "not
  // capped" rather than inventing a warning the route never sent.
  const poolTruncated = data?.poolTruncated === true;

  // e1e4e0ea — index the cross-scheme fairness matrix by candidateId so each card
  // can show its robust mean + own-vs-robust delta, and the columns can re-rank by
  // robustness. Guarded: needs aligned candidateIds and ≥2 candidates to matter.
  // The lockstep gate itself now lives in jobsFairnessMatrix.ts (pure + tested).
  const fairness = data?.fairness ?? null;
  const fairById = useMemo(() => indexFairnessMatrix(fairness), [fairness]);
  const hasFairness = fairById.size >= 2;
  const fairActive = fairRank && hasFairness;
  // Fair Rank on → order each column by the robust mean (desc); else keep the
  // engine's eligible-then-own-score order. Stable identity: it produces the arrays
  // the memoized columns receive, so an unstable one would defeat both memos.
  const orderRows = useCallback(
    (rows: CandRow[]): CandRow[] =>
      fairActive
        ? [...rows].sort(
            (a, b) =>
              (fairById.get(b.candidateId)?.mean ?? b.result.total) -
              (fairById.get(a.candidateId)?.mean ?? a.result.total)
          )
        : rows,
    [fairActive, fairById]
  );
  // The columns' `fair` prop. It was an inline `(id) => fairById.get(id)` written
  // TWICE in the render body — a fresh function per column per render, each of them
  // enough on its own to make that column's memo a no-op.
  const fairLookup = useMemo(
    () => (fairActive ? (id: string) => fairById.get(id) : undefined),
    [fairActive, fairById]
  );
  // The ordered arrays themselves, so a column's `rows` prop keeps its identity
  // across renders that changed neither the cohort nor the ordering.
  const experiencedOrdered = useMemo(() => orderRows(experienced), [orderRows, experienced]);
  const earlyCareerOrdered = useMemo(() => orderRows(earlyCareer), [orderRows, earlyCareer]);

  // Export the auditable matrix: per-scheme scores (matrix[i] = candidate i under
  // every candidate's weights) plus own / robust / delta. Reuses the shared CSV toolkit.
  //
  // F15 — the header row is the recruiter's own working copy of the on-screen audit
  // table (they press Export CSV and open it), so it is the UI user's language and
  // reuses the SAME four `audit*` labels the table renders. A bias-defensible record
  // whose columns say something different from the screen it came from is worse than
  // no record. The candidate labels in the rows are data and stay verbatim.
  const exportFairness = useCallback(() => {
    if (!fairness) return;
    const header = [
      t("auditCandidate"),
      t("auditOwn"),
      t("auditRobust"),
      t("auditDelta"),
      ...fairness.labels.map((l) => t("auditUnder", { label: l })),
    ];
    // Same lockstep rule as the index, applied to the exported record — a delta is
    // only written when BOTH sides of it exist. Pure + pinned in jobsFairnessMatrix.ts.
    const rows = fairnessCsvRows(fairness);
    // THE CAVEAT TRAVELS WITH THE ARTIFACT. When the pool was capped, this matrix
    // covers the scored subset only — and the file leaves the app: it is opened
    // later, by someone who never saw the amber note on the tab. A bias-defensible
    // record that does not state its own sampling is not one, so the first line of
    // the CSV says it, in the same words the panel it was exported from uses.
    const preamble = poolTruncated ? [[t("auditPoolTruncated")], []] : [];
    const name = `fair-rank-${(jobTitle || "role").replace(/\s+/g, "-")}.csv`;
    downloadFile(name, toCsv([...preamble, header, ...rows]), "text/csv");
  }, [fairness, poolTruncated, jobTitle, t]);

  return {
    data,
    loading,
    error,
    load,
    fairRank,
    poolFitOnly,
    setPoolFitOnly,
    setFairRank,
    added,
    adding,
    cardError,
    announce,
    reached,
    reaching,
    reachError,
    reachAnnounce,
    addToPipeline,
    reachOut,
    eligible,
    poolFitCount,
    earlyCareer,
    experienced,
    // Pre-ordered and memoized: what the columns actually render.
    experiencedOrdered,
    earlyCareerOrdered,
    fairLookup,
    notEligibleRows,
    notEligible,
    skipped,
    poolTruncated,
    fairness,
    fairById,
    hasFairness,
    fairActive,
    orderRows,
    exportFairness,
  };
}
