"use client";

// The decision log as a TABLE: sortable headers, header-cell filters, and a
// pager — the same three primitives every other long list in the studio uses
// (app/_components/table/), instead of the infinite scroll it had.
//
// Why the change matters beyond consistency: an infinite scroll can only ever
// answer "what happened most recently". An auditor's questions are "show me
// everything we did to this role", "which decisions were the machine's", "sort by
// candidate so I can find one" — and a growing scroll answers none of them. It
// also had no way back to the top and no notion of position: after loading 400
// rows the reader had no idea where they were.
//
// SERVER-side sort and page, unlike the Activity tab's client-side window. The
// audit trail must stay reachable in full (a bounded window would silently drop
// older decisions, which is the one thing an audit surface may not do), so it
// cannot be held in memory — and sorting the 20 rows on screen would look like
// ranking the whole trail while doing nothing of the sort. The pager therefore
// drives `offset`, and the header drives `?sort=`/`?dir=`.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { apiErrorPayload, LocalizedFailure, localizedFailureMessage } from "../analyticsFetchError";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { downloadFile, toCsv } from "@/app/_lib/export-utils";
import { DECISION_META, kindLabel, waveReasonText, type CohortProvenance } from "@/app/_lib/decision-attribution";
import { useDeliveryCapability } from "@/app/features/shell/useDeliveryCapability";
import { ColumnFilter } from "@/app/_components/table/ColumnFilter";
import { ColumnHead } from "@/app/_components/table/ColumnHead";
import { pageCount, TABLE_PAGE_SIZE, TablePager } from "@/app/_components/table/TablePager";
import type { SortState } from "@/app/_components/table/useTableSort";
import { META_LABEL, NOTICE, PANEL } from "@/app/_components/ui/recipes";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import {
  ATTRIBUTION_BADGE,
  compareNames,
  decisionMeta,
  formatAuditTime,
  resolveAuditTimeZone,
  withExportProvenance,
  type Decision,
  type DecisionPage,
} from "../analyticsDecisionLogTypes";

/** Page size for the whole-trail export's chained reads. The route caps `limit`
 *  at 50, so this is the largest page it will honour: 174 rows = 4 requests. */
const TRAIL_FETCH_LIMIT = 50;
/** Hard stop on the export loop, so a paging bug can never spin forever. */
const TRAIL_MAX_PAGES = 400;

/** Mirrors the store's allowlist (db/pipeline.ts EVENT_SORT_COLUMNS). */
type Col = "createdAt" | "candidateLabel" | "jobTitle" | "kind";

export function DecisionLogTable({
  attribution,
  kind,
  setAttribution,
  setKind,
  boardHref,
}: {
  attribution: "auto" | "human" | null;
  kind: string;
  setAttribution: (a: "auto" | "human" | null) => void;
  setKind: (k: string) => void;
  boardHref: (q: string) => string;
}) {
  const t = useTranslations("analytics.log");
  // §1.1 — a failure is shown from its machine code, in the reader's language.
  const errMsg = useErrorMessage();
  const tWave = useTranslations("decisions.wave");
  const locale = useLocale();
  const enumLabel = useEnumLabel();
  const relayConfigured = useDeliveryCapability();

  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<SortState<Col>>({ col: "createdAt", dir: "desc" });
  // UAT LUC-ANA-5 — subject search. `subject` is what the reader is typing;
  // `query` is what has actually been sent. Debounced because every change is a
  // server read of the whole trail's refinement path, not a client filter.
  const [subject, setSubject] = useState("");
  const [query, setQuery] = useState("");
  const [trailBusy, setTrailBusy] = useState(false);
  const [trailError, setTrailError] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(subject.trim());
      setPage(0);
    }, 250);
    return () => clearTimeout(id);
  }, [subject]);

  // UAT LUC-ANA-7 — ONE clock for this surface. The rows used to print
  // `createdAt.slice(0,16)`, a UTC instant with no marker that a Prague reader
  // read as local, while the CSV wrote the true ISO: screen and export disagreed
  // by two hours on an audit artifact. Both now render through formatAuditTime in
  // this zone, the export carries the ISO instant BESIDE the rendered one, and the
  // zone is named in both places.
  const zone = useMemo(() => resolveAuditTimeZone(), []);

  const queryUrl = useCallback(
    (offset: number, limit: number) => {
      const params = new URLSearchParams({ offset: String(offset), limit: String(limit), sort: sort.col, dir: sort.dir, locale });
      // UAT LUC-ANA-12 — send BOTH. This was `if (kind) … else if (attribution)`, so
      // picking a decision kind quietly stopped sending the Kdo filter while its column
      // kept the active dot lit: the table said it had narrowed on two axes and had
      // narrowed on one. The route now intersects them (and answers an empty page for a
      // contradictory pair) rather than choosing a winner.
      if (kind) params.set("kind", kind);
      if (attribution) params.set("attribution", attribution);
      if (query) params.set("q", query);
      return `/api/analytics/decisions?${params.toString()}`;
    },
    [sort.col, sort.dir, kind, attribution, query, locale]
  );

  const url = useMemo(() => queryUrl(page * TABLE_PAGE_SIZE, TABLE_PAGE_SIZE), [queryUrl, page]);

  const { data, error } = useJsonFetch<DecisionPage>(url, t("loadFailed"));
  const rows = data?.decisions ?? [];
  const total = data?.total ?? 0;

  // Changing the sort or a filter must reset to page 1: staying on page 7 of a
  // result set that just shrank shows an empty table that looks like "no data"
  // rather than "you are past the end".
  const onSort = (col: Col) => {
    setSort((prev) => (prev.col === col ? { col, dir: prev.dir === "asc" ? "desc" : "asc" } : { col, dir: "desc" }));
    setPage(0);
  };
  const onFilterKind = (k: string) => {
    setKind(k);
    setPage(0);
  };
  const onFilterAttribution = (a: string) => {
    setAttribution(a === "auto" || a === "human" ? a : null);
    setPage(0);
  };

  const cohortText = (c: CohortProvenance): string =>
    t(c.source === "selection" ? "cohortSelection" : "cohortTop", { compared: c.compared, field: c.field });
  const reasonText = (d: Decision): string | null => (d.reason ? waveReasonText(tWave, d.reason) : null);
  const detailText = (d: Decision): string | null =>
    reasonText(d) ?? (d.counterpart ? t("csvRematchCounterpart", { name: d.counterpart.label }) : d.detail);

  // The dropdown's labels are translated, so they must collate under the READER's
  // locale — a bare localeCompare() uses the RUNTIME's default, which is the
  // browser's language, not the app's. Under en-US a Czech label beginning Č sorts
  // as a C variant; cs ranks Č as its own letter after C. `compareNames` is the
  // Intl.Collator the sibling table in this directory already routes its two text
  // columns through (DecisionRecordsTable, UAT LUC-ANA-5) — same module, same
  // import, so the two surfaces of one audit trail cannot order names differently.
  const kindOptions = Object.keys(DECISION_META)
    .map((k) => ({ value: k, label: kindLabel(t, k, { relayConfigured }) }))
    .sort((a, b) => compareNames(a.label, b.label, locale, "asc"));

  const attributionOptions = [
    { value: "auto", label: t("attribution.auto") },
    { value: "human", label: t("attribution.human") },
  ];

  // UAT LUC-ANA-11 — the active narrowing, spelled out for the export's provenance
  // block. An audit CSV that does not carry its own filters cannot be reproduced,
  // and a reader who receives it has no way to know what was left out.
  const filterPieces = [
    kind ? `${t("colDecision")}: ${kindLabel(t, kind, { relayConfigured })}` : null,
    attribution ? `${t("colBy")}: ${t(`attribution.${attribution}` as Parameters<typeof t>[0])}` : null,
    query ? `${t("colCandidate")}: ${query}` : null,
  ].filter((p): p is string => p !== null);
  const filtersText = filterPieces.length > 0 ? filterPieces.join(" · ") : t("filtersNone");

  // Both exports go through ONE builder, so the page export and the whole-trail
  // export can never carry different columns or a different clock — only a
  // different declared scope.
  const csvFor = (list: Decision[], scope: string): string =>
    toCsv(
      withExportProvenance(
        [
          [t("provExport"), t("title")],
          [t("provGenerated"), formatAuditTime(new Date().toISOString(), locale, zone)],
          [t("provZone"), zone],
          [t("provLocale"), locale],
          [t("provScope"), scope],
          [t("provFilters"), filtersText],
        ],
        // The rendered time AND the ISO instant, in that order: the first matches
        // the screen, the second is the unambiguous machine value. Dropping either
        // is what made the two disagree.
        [t("csvTimeLocal", { zone }), t("csvTimeIso"), t("csvAttribution"), t("csvKind"), t("csvCandidate"), t("csvRole"), t("csvCohort"), t("csvDetail")],
        list.map((d) => [
          formatAuditTime(d.createdAt, locale, zone),
          d.createdAt,
          t(`attribution.${decisionMeta(d.kind).attribution}` as Parameters<typeof t>[0]),
          kindLabel(t, d.kind, { relayConfigured }),
          d.candidateLabel,
          d.jobTitle,
          d.cohort ? cohortText(d.cohort) : null,
          detailText(d),
        ])
      )
    );

  // Exports the CURRENT page, and the header says so — the previous version
  // exported "the loaded set", a number that depended on how far the reader had
  // happened to scroll and was therefore impossible to describe in the file.
  const exportCsv = () => {
    const shownPage = Math.min(page, Math.max(0, pageCount(total) - 1)) + 1;
    const scope = t("scopePage", { page: shownPage, pages: Math.max(1, pageCount(total)), rows: rows.length, total });
    downloadFile(`kp-decision-log-page-${shownPage}.csv`, csvFor(rows, scope), "text/csv");
  };

  // UAT LUC-ANA-11 — the whole trail in one file. 174 rows at 20 per click was
  // nine downloads, so "export the audit trail" was in practice not offered. The
  // loop pages the SAME endpoint with the SAME filters (G4: server-paged, never
  // windowed) and the file names the scope it actually reached.
  const exportTrail = async () => {
    setTrailBusy(true);
    setTrailError(null);
    try {
      const all: Decision[] = [];
      let offset = 0;
      let reported = 0;
      for (let i = 0; i < TRAIL_MAX_PAGES; i++) {
        const res = await fetch(queryUrl(offset, TRAIL_FETCH_LIMIT));
        // The route answers TOO_MANY_REQUESTS (429, wait and retry) and
        // DECISION_LOG_LOAD_FAILED (500, the read fell over) with codes; the raw
        // status this used to throw collapsed both into one red line, and the number
        // itself never reached a reader.
        if (!res.ok) throw new LocalizedFailure(errMsg(await apiErrorPayload(res), t("exportTrailFailed")));
        const body = (await res.json()) as DecisionPage & { code?: string };
        if (body.error) throw new LocalizedFailure(errMsg(body, t("exportTrailFailed")));
        all.push(...body.decisions);
        reported = body.total;
        if (!body.hasMore || body.decisions.length === 0) break;
        offset = body.nextOffset;
      }
      downloadFile("kp-decision-log-trail.csv", csvFor(all, t("scopeTrail", { rows: all.length, total: reported })), "text/csv");
    } catch (err) {
      // Truthful failure: a partial file silently named "whole trail" is exactly
      // the artifact an auditor must never be handed. WHY it failed now survives the
      // catch — resolved from the code above, generic for anything unlocalized.
      setTrailError(localizedFailureMessage(err, t("exportTrailFailed")));
    } finally {
      setTrailBusy(false);
    }
  };

  return (
    <div className={`${PANEL} p-5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="font-serif text-h2 text-ink">{t("title")}</h3>
        <div className="flex flex-wrap items-baseline gap-3">
          <p className={META_LABEL}>
            {total > 0 ? t("countAuditable", { shown: rows.length, total }) : t("subtitle")}
          </p>
          {/* UAT LUC-ANA-7 — the clock this table runs on, named once beside the
              count rather than repeated in every cell. */}
          <p className={META_LABEL}>{t("timeZoneNote", { zone })}</p>
          <button
            type="button"
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="focus-ring inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white px-2.5 py-1 text-sm font-medium text-steel hover:bg-paper hover:text-ink disabled:opacity-50 print:hidden"
          >
            <Download size={12} aria-hidden /> {t("exportPage")}
          </button>
          <button
            type="button"
            onClick={exportTrail}
            disabled={total === 0 || trailBusy}
            className="focus-ring inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white px-2.5 py-1 text-sm font-medium text-steel hover:bg-paper hover:text-ink disabled:opacity-50 print:hidden"
          >
            <Download size={12} aria-hidden /> {trailBusy ? t("exportTrailBusy") : t("exportTrail")}
          </button>
        </div>
      </div>
      {trailError ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {trailError}
        </p>
      ) : null}
      {/* UAT LUC-ANA-5 — a search that could not reach the whole trail must say so.
          The scan is bounded (route: SUBJECT_REFINE_MAX); above the bound it read the
          most recent N decisions, which is a scope, not a silent truncation. */}
      {data?.subjectScan?.capped ? (
        <p className={`mt-2 ${NOTICE()} px-3 py-2 text-sm`}>
          {t("scanCapped", { scanned: data.subjectScan.scanned, total: data.subjectScan.trailTotal })}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-base text-red-700">{error}</p>
      ) : !data ? (
        <LoadingGap className="mt-3 min-h-[15rem]" />
      ) : (
        <>
          {/* A table forced past the viewport by min-w scrolls inside this div. A bare
                overflow container is not reachable without a pointer in every browser
                (current Chrome/Firefox focus scroll containers on their own; Safari
                does not), so it is a NAMED, focusable region -- which also gives the
                data surface an accessible name it did not have. */}
          <div className="mt-3 overflow-x-auto" role="region" tabIndex={0} aria-label={t("title")}>
            <table aria-label={t("title")} className="w-full min-w-[52rem] text-base">
              <thead>
                <tr className="border-b border-stone-200">
                  <ColumnHead title={t("colWhen")} sortCol="createdAt" sort={sort} onSort={onSort} />
                  {/* UAT LUC-ANA-5 — the auditor's first question is "show me everything
                      we did to THIS person", and the only lookup this column had was
                      paging. mode="search" is the primitive the by-role table already
                      uses; the match is diacritic-folded and the ordering is Intl-collated,
                      both server-side (route), because the trail is server-paged. */}
                  <ColumnHead title={t("colCandidate")} sortCol="candidateLabel" sort={sort} onSort={onSort}>
                    <ColumnFilter title={t("colCandidate")} trigger="icon" mode="search" value={subject} onChange={setSubject} />
                  </ColumnHead>
                  <ColumnHead title={t("colRole")} sortCol="jobTitle" sort={sort} onSort={onSort} />
                  <ColumnHead title={t("colDecision")} sortCol="kind" sort={sort} onSort={onSort}>
                    <ColumnFilter title={t("colDecision")} trigger="icon" value={kind} onChange={onFilterKind} options={kindOptions} />
                  </ColumnHead>
                  {/* Attribution has no meaningful order (auto is not "more" than
                      human), so it filters but does not sort. */}
                  <ColumnHead title={t("colBy")} sort={sort} onSort={onSort}>
                    <ColumnFilter
                      title={t("colBy")}
                      trigger="icon"
                      value={attribution ?? ""}
                      onChange={onFilterAttribution}
                      options={attributionOptions}
                    />
                  </ColumnHead>
                  <ColumnHead title={t("colDetail")} sort={sort} onSort={onSort} />
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const m = decisionMeta(d.kind);
                  const detail = detailText(d);
                  return (
                    <tr key={d.id} className="border-b border-stone-100 align-top last:border-0 hover:bg-paper/50">
                      {/* The ISO instant stays reachable on hover: the rendered value is
                          zone-bound, the title is the value the CSV's second column carries. */}
                      <td className="whitespace-nowrap py-2 pr-3 text-sm text-steel nums" title={d.createdAt}>
                        {formatAuditTime(d.createdAt, locale, zone) || "—"}
                      </td>
                      <td className="py-2 pr-3">
                        {d.candidateLabel && d.entryId ? (
                          <Link
                            href={boardHref(d.candidateLabel)}
                            className="focus-ring rounded font-medium text-ink underline-offset-2 hover:text-coral hover:underline"
                          >
                            {d.candidateLabel}
                          </Link>
                        ) : (
                          <span className="text-steel">{d.candidateLabel ?? t("boardLevelRow")}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-steel">{d.jobTitle ?? "—"}</td>
                      <td className="py-2 pr-3 text-ink">
                        {kindLabel(t, d.kind, { relayConfigured })}
                        {d.toStage ? (
                          <span className="block text-sm text-steel">
                            {d.fromStage ? `${enumLabel("stage", d.fromStage)} → ` : ""}
                            {enumLabel("stage", d.toStage)}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${ATTRIBUTION_BADGE[m.attribution]}`}>
                          {t(`attribution.${m.attribution}` as Parameters<typeof t>[0])}
                        </span>
                      </td>
                      <td className="py-2 text-sm text-steel">
                        {/* UAT LUC-ANA-10 (sibling of the records table's expander): a
                            clamped legal basis with no way to read the rest is a column an
                            auditor has to leave the screen to use. Here the full text is at
                            least reachable on hover. */}
                        {detail ? (
                          <span className="line-clamp-2" title={detail}>
                            {detail}
                          </span>
                        ) : null}
                        {d.cohort ? <span className="block text-sm text-steel/80">{cohortText(d.cohort)}</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {rows.length === 0 ? (
            <p className="py-6 text-center text-base text-steel">{kind || attribution || query ? t("noMatches") : t("empty")}</p>
          ) : (
            <div className="mt-3">
              {/* Server-paged: the pager reports position within `total`, not
                  within a loaded slice, so "page 3 of 47" is the real trail. */}
              <TablePager page={Math.min(page, pageCount(total) - 1)} total={total} onPage={setPage} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
