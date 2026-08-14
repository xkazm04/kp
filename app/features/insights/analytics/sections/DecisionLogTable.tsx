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
import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { downloadFile, toCsv } from "@/app/_lib/export-utils";
import { DECISION_META, kindLabel, waveReasonText, type CohortProvenance } from "@/app/_lib/decision-attribution";
import { useDeliveryCapability } from "@/app/features/shell/useDeliveryCapability";
import { ColumnFilter } from "@/app/_components/table/ColumnFilter";
import { ColumnHead } from "@/app/_components/table/ColumnHead";
import { pageCount, TABLE_PAGE_SIZE, TablePager } from "@/app/_components/table/TablePager";
import type { SortState } from "@/app/_components/table/useTableSort";
import { PANEL } from "@/app/_components/ui/recipes";
import { ATTRIBUTION_BADGE, decisionMeta, type Decision, type DecisionPage } from "../analyticsDecisionLogTypes";

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
  const tWave = useTranslations("decisions.wave");
  const enumLabel = useEnumLabel();
  const relayConfigured = useDeliveryCapability();

  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<SortState<Col>>({ col: "createdAt", dir: "desc" });

  const url = useMemo(() => {
    const params = new URLSearchParams({
      offset: String(page * TABLE_PAGE_SIZE),
      limit: String(TABLE_PAGE_SIZE),
      sort: sort.col,
      dir: sort.dir,
    });
    if (kind) params.set("kind", kind);
    else if (attribution) params.set("attribution", attribution);
    return `/api/analytics/decisions?${params.toString()}`;
  }, [page, sort.col, sort.dir, kind, attribution]);

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

  const kindOptions = Object.keys(DECISION_META)
    .map((k) => ({ value: k, label: kindLabel(t, k, { relayConfigured }) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const attributionOptions = [
    { value: "auto", label: t("attribution.auto") },
    { value: "human", label: t("attribution.human") },
  ];

  // Exports the CURRENT page, and the header says so — the previous version
  // exported "the loaded set", a number that depended on how far the reader had
  // happened to scroll and was therefore impossible to describe in the file.
  const exportCsv = () => {
    downloadFile(
      "kp-decision-log.csv",
      toCsv([
        [t("csvTime"), t("csvAttribution"), t("csvKind"), t("csvCandidate"), t("csvRole"), t("csvCohort"), t("csvDetail")],
        ...rows.map((d) => [
          d.createdAt,
          t(`attribution.${decisionMeta(d.kind).attribution}` as Parameters<typeof t>[0]),
          kindLabel(t, d.kind, { relayConfigured }),
          d.candidateLabel,
          d.jobTitle,
          d.cohort ? cohortText(d.cohort) : null,
          detailText(d),
        ]),
      ]),
      "text/csv"
    );
  };

  return (
    <div className={`${PANEL} p-5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="font-serif text-h2 text-ink">{t("title")}</h3>
        <div className="flex items-baseline gap-3">
          <p className="text-meta uppercase text-steel">
            {total > 0 ? t("countAuditable", { shown: rows.length, total }) : t("subtitle")}
          </p>
          <button
            type="button"
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="focus-ring inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white px-2.5 py-1 text-sm font-medium text-steel hover:bg-paper hover:text-ink disabled:opacity-50 print:hidden"
          >
            <Download size={12} aria-hidden /> {t("exportPage")}
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-base text-red-700">{error}</p>
      ) : !data ? (
        <div className="reveal-quiet mt-3 min-h-[15rem]" aria-hidden />
      ) : (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[52rem] text-base">
              <thead>
                <tr className="border-b border-stone-200">
                  <ColumnHead title={t("colWhen")} sortCol="createdAt" sort={sort} onSort={onSort} />
                  <ColumnHead title={t("colCandidate")} sortCol="candidateLabel" sort={sort} onSort={onSort} />
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
                      <td className="whitespace-nowrap py-2 pr-3 text-sm text-steel nums">
                        {d.createdAt.slice(0, 16).replace("T", " ")}
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
                        {detail ? <span className="line-clamp-2">{detail}</span> : null}
                        {d.cohort ? <span className="block text-sm text-steel/80">{cohortText(d.cohort)}</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {rows.length === 0 ? (
            <p className="py-6 text-center text-base text-steel">{kind || attribution ? t("noMatches") : t("empty")}</p>
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
