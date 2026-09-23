"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { BTN_SECONDARY, CARD_PAD, DIVIDER, EYEBROW, INTRO, PANEL, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { HistoryFilterBar } from "./HistoryFilterBar";
import { HistoryTable } from "./HistoryTable";
import { HistoryTriageDrawer } from "./HistoryTriageDrawer";
import { applyDecision, pruneToFilter, type TriageDecision, type TriageMode } from "./historyTriage";
import type { AnalysisRow } from "./HistoryTypes";
import {
  isHistoryFiltering,
  mergeHistoryPages,
  readHistoryPage,
  toSearchParams,
  type HistoryFacets,
  type HistoryQuery,
} from "./historyQuery";

/** How long the search box rests before it asks the server. The dropdowns ask at once. */
const SEARCH_DEBOUNCE_MS = 250;

const analysesUrl = (query: HistoryQuery, cursor?: string | null) => {
  const qs = toSearchParams(query, cursor);
  return qs ? `/api/analyses?${qs}` : `/api/analyses`;
};

export function HistoryTab() {
  const t = useTranslations("history");
  const dispLabel = (d: string) => {
    const key = `disposition.${d}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : d;
  };
  const [rows, setRows] = useState<AnalysisRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The route's exact cap+1 answer: true means more groups match THIS query than are on
  // screen, and nextCursor is where they start. Default false is "the route has not
  // said truncated", not a completeness claim of our own.
  const [truncated, setTruncated] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  // The dropdown vocabulary for the WHOLE workspace, from the server. Deriving it from
  // the loaded rows could never offer a family only older runs carry.
  const [facets, setFacets] = useState<HistoryFacets>({ families: [], seniorities: [] });
  // Search + filter (RES3), asked of the SERVER (challenge-r09 cv-analyze-workspace/A).
  // History used to filter the newest 200 groups it had loaded, so past that cap a
  // search missed older candidates and 'undecided' under-counted; the route now filters
  // the whole workspace before its window. The recorded disposition (RES5) is
  // filterable; "undecided" matches a group with no recorded decision.
  const [q, setQ] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [roleFamily, setRoleFamily] = useState("");
  const [seniority, setSeniority] = useState("");
  const [disposition, setDisposition] = useState("");
  const applied: HistoryQuery = { q: appliedQ, family: roleFamily, seniority, disposition };
  // Triage (challenge-r09 cv-analyze-workspace/B): the row the drawer is deciding on,
  // and whether its walk skips runs that already carry a decision.
  const [triageSlug, setTriageSlug] = useState<string | null>(null);
  const [triageMode, setTriageMode] = useState<TriageMode>("undecided");
  // A decision the server holds: repaint that row in place (pill, note, counts).
  const onDecided = useCallback((slug: string, decision: TriageDecision) => {
    setRows((prev) => (prev ? applyDecision(prev, slug, decision) : prev));
  }, []);
  // Closing hands the list back to its own filter: a run decided under 'undecided'
  // drops out, as the next refetch would drop it server-side.
  const closeTriage = () => {
    setTriageSlug(null);
    setRows((prev) => (prev ? pruneToFilter(prev, disposition) : prev));
  };

  // One generation per page-1 load: only the latest query's answer is applied, so a
  // fast typist, a retry or a locale switch mid-load can never paint a stale list, and
  // a Load more that returns after the query changed is dropped rather than appended
  // to the wrong list. State is only written in the async continuation (never
  // synchronously when the effect fires).
  const reqGen = useRef(0);
  const load = useCallback(
    (query: HistoryQuery) => {
      const gen = ++reqGen.current;
      fetch(analysesUrl(query))
        .then(async (response) => {
          if (!response.ok) throw new Error(t("loadFailedStatus", { status: response.status }));
          const payload = await response.json();
          if (reqGen.current === gen) {
            const page = readHistoryPage(payload);
            setRows(page.analyses);
            setTruncated(page.truncated);
            setNextCursor(page.nextCursor);
            if (page.facets) setFacets(page.facets);
            setMoreFailed(false);
            setError(null);
          }
        })
        .catch((caught) => {
          if (reqGen.current === gen) {
            setError(caught instanceof Error ? caught.message : t("loadFailed"));
            setRows(null);
            setTruncated(false);
            setNextCursor(null);
          }
        });
    },
    [t]
  );

  // The search box asks after a pause; the dropdowns ask on change.
  useEffect(() => {
    const timer = setTimeout(() => setAppliedQ(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    load({ q: appliedQ, family: roleFamily, seniority, disposition });
  }, [load, appliedQ, roleFamily, seniority, disposition]);

  // "Try again": clear the failure and show the loading state immediately (a
  // synchronous set is fine in an event handler), then refetch the same query.
  const retry = () => {
    setError(null);
    setRows(null);
    load(applied);
  };

  // The next keyset page of the SAME query, merged by slug in server order.
  const loadMore = () => {
    if (!nextCursor || loadingMore) return;
    const gen = reqGen.current;
    setLoadingMore(true);
    setMoreFailed(false);
    fetch(analysesUrl(applied, nextCursor))
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const page = readHistoryPage(await response.json());
        if (reqGen.current !== gen) return;
        setRows((prev) => mergeHistoryPages(prev ?? [], page.analyses));
        setTruncated(page.truncated);
        setNextCursor(page.nextCursor);
      })
      .catch(() => {
        if (reqGen.current === gen) setMoreFailed(true);
      })
      .finally(() => setLoadingMore(false));
  };

  // Whether the rows on screen ANSWER a narrowed query (the empty state differs), and
  // whether the recruiter is narrowing right now (the Clear control).
  const answersFilter = isHistoryFiltering(applied);
  const filtering = isHistoryFiltering({ ...applied, q });
  const clearAll = () => {
    setQ("");
    setAppliedQ("");
    setRoleFamily("");
    setSeniority("");
    setDisposition("");
  };

  return (
    // Tier 1 (docs/design/loading-choreography.md): header + the fetch-dependent
    // region cascade in as this section's direct children. aria-busy covers
    // only the FIRST load — rows, once loaded, are never nulled out by a query
    // change (the previous answer stays until the next one lands).
    <section className={`stagger-children ${PANEL} ${CARD_PAD}`} aria-busy={rows == null && !error}>
      <header className={`${DIVIDER} border-t-0 border-b pb-4`}>
        <p className={EYEBROW}>{t("eyebrow")}</p>
        <h2 className={`mt-1 ${TITLE_DISPLAY}`}>{t("title")}</h2>
        <p className={`mt-2 max-w-3xl ${INTRO}`}>{t("intro")}</p>
      </header>

      <div className="mt-5">
        {error ? (
          <div className="rounded-md bg-red-50 p-3 text-base text-red-700">
            <p>{error}</p>
            <button
              type="button"
              onClick={retry}
              className="focus-ring mt-2 rounded-md border border-red-200 bg-white px-3 py-1 text-sm font-semibold text-red-700 hover:bg-red-100"
            >
              {t("retry")}
            </button>
          </div>
        ) : rows == null ? (
          // Tier 2: the first fetch is in flight and there is nothing to show
          // yet. Reserve the table's rough height and stay invisible for
          // 150ms so a fast response never flashes a "Loading…" line at all.
          <div className="reveal-quiet min-h-[16rem]" aria-hidden />
        ) : rows.length === 0 && !answersFilter && !filtering ? (
          <p className="rounded-md bg-paper p-4 text-base text-steel">
            {t.rich("emptyNoRuns", { b: (chunks) => <strong>{chunks}</strong> })}
          </p>
        ) : (
          <>
            <HistoryFilterBar
              q={q}
              setQ={setQ}
              roleFamily={roleFamily}
              setRoleFamily={setRoleFamily}
              seniority={seniority}
              setSeniority={setSeniority}
              disposition={disposition}
              setDisposition={setDisposition}
              families={facets.families}
              seniorities={facets.seniorities}
              filtering={filtering}
              answersFilter={answersFilter}
              shownCount={rows.length}
              truncated={truncated}
              onClear={clearAll}
              dispLabel={dispLabel}
            />
            {rows.length === 0 ? (
              <p className="mt-4 rounded-md bg-paper p-4 text-base text-steel">
                {t("noMatch")}{" "}
                <button type="button" onClick={clearAll} className="font-semibold text-coral underline underline-offset-2">
                  {t("clearFilters")}
                </button>
              </p>
            ) : (
              <HistoryTable rows={rows} dispLabel={dispLabel} onDecide={setTriageSlug} />
            )}
            {nextCursor ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="button" onClick={loadMore} disabled={loadingMore} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
                  {loadingMore ? t("loading") : t("loadMore")}
                </button>
                {moreFailed ? (
                  <span role="status" className="text-sm text-red-700">
                    {t("loadFailed")}
                  </span>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
      {triageSlug && rows ? (
        <HistoryTriageDrawer
          rows={rows}
          slug={triageSlug}
          mode={triageMode}
          onModeChange={setTriageMode}
          truncated={truncated}
          onNavigate={setTriageSlug}
          onDecided={onDecided}
          onClose={closeTriage}
        />
      ) : null}
    </section>
  );
}
