"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CARD_PAD, DIVIDER, EYEBROW, INTRO, PANEL, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { HistoryFilterBar } from "./HistoryFilterBar";
import { HistoryTable } from "./HistoryTable";
import { distinct, type AnalysisRow } from "./HistoryTypes";

export function HistoryTab() {
  const t = useTranslations("history");
  const dispLabel = (d: string) => {
    const key = `disposition.${d}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : d;
  };
  const [rows, setRows] = useState<AnalysisRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Client-side search + filter (RES3). History was an un-queryable flat table —
  // unusable past a few dozen runs. Filtering the loaded set (≤200 rows) needs no
  // schema/server change; server-side query params + tagging are a follow-up for
  // when history outgrows that cap.
  const [q, setQ] = useState("");
  const [roleFamily, setRoleFamily] = useState("");
  const [seniority, setSeniority] = useState("");
  // RES3 follow-up (06-10 scan #3): the recorded disposition (RES5) is the
  // strongest triage signal on the table but postdated the filter bar — make it
  // filterable. "undecided" matches rows with no recorded decision.
  const [disposition, setDisposition] = useState("");

  // Extracted so the error panel's "Try again" can re-run it IN PLACE — a transient
  // SQLITE_BUSY / 500 on tab-open (or a workspace switch) otherwise dead-ended at a red
  // panel with no recovery but a full page reload. A generation ref means only the
  // latest request's result is applied, so rapid retries / a locale switch mid-load
  // can't write a stale rows/error. State is only written in the async continuation
  // (never synchronously when the effect fires); the retry handler below does the
  // synchronous loading-state reset in its event handler instead.
  const reqGen = useRef(0);
  const load = useCallback(() => {
    const gen = ++reqGen.current;
    fetch("/api/analyses")
      .then(async (response) => {
        if (!response.ok) throw new Error(t("loadFailedStatus", { status: response.status }));
        const payload = await response.json();
        if (reqGen.current === gen) {
          setRows((payload.analyses as AnalysisRow[]) ?? []);
          setError(null);
        }
      })
      .catch((caught) => {
        if (reqGen.current === gen) {
          setError(caught instanceof Error ? caught.message : t("loadFailed"));
          setRows(null);
        }
      });
  }, [t]);

  // "Try again": clear the failure and show the loading state immediately (a
  // synchronous set is fine in an event handler), then refetch.
  const retry = () => {
    setError(null);
    setRows(null);
    load();
  };

  useEffect(() => {
    load();
  }, [load]);

  const families = useMemo(() => distinct((rows ?? []).map((r) => r.role_family)), [rows]);
  const seniorities = useMemo(() => distinct((rows ?? []).map((r) => r.seniority)), [rows]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter(
      (r) =>
        (!needle || r.candidate_label.toLowerCase().includes(needle) || r.slug.toLowerCase().includes(needle)) &&
        (!roleFamily || r.role_family === roleFamily) &&
        (!seniority || r.seniority === seniority) &&
        (!disposition || (disposition === "undecided" ? r.disposition == null : r.disposition === disposition))
    );
  }, [rows, q, roleFamily, seniority, disposition]);
  const filtering = Boolean(q.trim() || roleFamily || seniority || disposition);
  const clearAll = () => {
    setQ("");
    setRoleFamily("");
    setSeniority("");
    setDisposition("");
  };

  return (
    // Tier 1 (docs/design/loading-choreography.md): header + the fetch-dependent
    // region cascade in as this section's direct children. aria-busy covers
    // only the FIRST load — rows, once loaded, are never nulled out by this
    // component again, so a later render never re-blanks what's on screen.
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
        ) : rows.length === 0 ? (
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
              families={families}
              seniorities={seniorities}
              filtering={filtering}
              filteredCount={filtered.length}
              totalCount={rows.length}
              onClear={clearAll}
              dispLabel={dispLabel}
            />
            {filtered.length === 0 ? (
              <p className="mt-4 rounded-md bg-paper p-4 text-base text-steel">
                {t("noMatch")}{" "}
                <button type="button" onClick={clearAll} className="font-semibold text-coral underline underline-offset-2">
                  {t("clearFilters")}
                </button>
              </p>
            ) : (
              <HistoryTable rows={filtered} dispLabel={dispLabel} />
            )}
          </>
        )}
      </div>
    </section>
  );
}
