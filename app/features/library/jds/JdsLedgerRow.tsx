"use client";

import { Copy, History, Loader2, Maximize2, Users } from "lucide-react";
import { useLocale } from "next-intl";
import type { useTranslations } from "next-intl";
import { PipelineShapeBar } from "@/app/_components/ui/PipelineShapeBar";
import { isUnlinked, shortDate, type JdRow } from "./jdsLibrary";
import { AnalyzingChip, SeniorityCell, StatusBadge } from "./JdsLedgerBadges";
import { RowIngest } from "./JdsLedgerRowIngest";

const ICON_BTN =
  "focus-ring inline-grid h-8 w-8 place-items-center rounded-md text-steel transition-colors hover:bg-paper hover:text-coral disabled:opacity-40";

// One saved-JD table row — extracted verbatim from JdsLedgerTable.tsx so that
// file stays under the 200-line split threshold.
export function JdsLedgerRow({
  row,
  enumLabel,
  reload,
  duplicating,
  peak,
  onOpenRow,
  onDuplicate,
  onIngested,
  held = false,
  t,
}: {
  row: JdRow;
  enumLabel: (cat: string, value: string | null | undefined) => string;
  reload: () => void;
  duplicating: string | null;
  /** Largest pipeline in the visible set — the shape bar's width scale. */
  peak: number;
  onOpenRow: (row: JdRow, opts?: { history?: boolean }) => void;
  onDuplicate: (row: JdRow) => void;
  onIngested: (slug: string, jobId: string | null) => void;
  /** This build's markdown never became the JD's body — it was filed as a revision
   *  because the recruiter edited the row while the build ran (see useHeldBuilds). */
  held?: boolean;
  t: ReturnType<typeof useTranslations<"library.tab">>;
}) {
  // The saved-on stamp follows the APP locale, not the browser/OS one (see shortDate).
  const locale = useLocale();
  const analyzed = row.analysisCount ?? 0;
  const pipeline = row.pipeline ?? null;
  return (
    <tr className="group transition-colors hover:bg-paper">
      {/* Role. The title is width-capped so the eight-column table fits its panel
          instead of scrolling the row actions off-screen — it already overflowed
          by ~136px before the Pipeline column existed. The full title stays
          available via the tooltip and the detail modal the row opens. */}
      <td className="px-3 py-2.5 align-middle">
        <button
          type="button"
          onClick={() => onOpenRow(row)}
          className="focus-ring block max-w-[13rem] truncate text-left text-sm font-semibold text-ink hover:text-coral"
          title={row.title}
        >
          {row.title}
        </button>
      </td>
      <td className="px-3 py-2.5 align-middle text-sm text-steel">
        {row.roleFamily ? enumLabel("family", row.roleFamily) : <span className="text-stone-400">—</span>}
      </td>
      <td className="px-3 py-2.5 align-middle">
        <SeniorityCell value={row.seniority} />
      </td>
      <td className="px-3 py-2.5 align-middle">
        {row.analysis_status === "analyzing" ? (
          <AnalyzingChip />
        ) : (
          <StatusBadge row={row} muted={isUnlinked(row)} />
        )}
        {/* The row flips to "ready" whether or not the build's markdown became the
            body, so a held build is invisible on the status alone: the recruiter
            keeps their own text and a fresh AI draft sits unread in the history.
            The chip says so and opens straight to it. */}
        {held ? (
          <button
            type="button"
            onClick={() => onOpenRow(row, { history: true })}
            title={t("buildHeldHint")}
            className="focus-ring mt-1 inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-sm font-semibold text-amber-800 hover:border-coral/40"
          >
            <History size={12} aria-hidden /> {t("buildHeldChip")}
          </button>
        ) : null}
      </td>
      {/* Pipeline — the role's live state as ONE cell: a comparable shape, the
          headcount, and the hires when there are any. Deliberately not split into
          separate Pipeline / Hired columns — that overflowed the table and pushed
          Analyzed, Saved and the row actions off-screen, and "how is this role
          doing" is one question anyway.
          `null` (no linked job) reads as a dash, not a zero: "this JD was never
          ingested" and "this role has nobody in it yet" are different facts and
          the recruiter acts differently on each. */}
      <td className="px-3 py-2.5 align-middle">
        {pipeline ? (
          <span className="flex items-center gap-2">
            <span className="w-16 shrink-0">
              <PipelineShapeBar
                label={row.title}
                total={pipeline.total}
                reachedInterview={pipeline.reachedInterview}
                hired={pipeline.hired}
                peak={peak}
              />
            </span>
            <span className={`nums text-sm ${pipeline.total ? "text-ink" : "text-stone-400"}`}>{pipeline.total}</span>
            {pipeline.hired > 0 ? (
              <span className="nums whitespace-nowrap text-sm font-semibold text-moss">
                {t("hiredInline", { n: pipeline.hired, pct: pipeline.hireRatePct })}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-sm text-stone-400" title={t("noLinkedJob")}>
            —
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right align-middle">
        <span className={`inline-flex items-center gap-1.5 text-sm ${analyzed ? "text-ink" : "text-stone-400"}`}>
          <Users size={14} aria-hidden />
          <span className="nums font-semibold">{analyzed}</span>
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 align-middle text-sm text-steel">{shortDate(row.created_at, locale)}</td>
      <td className="px-3 py-2.5 align-middle">
        <div className="flex items-center justify-end gap-0.5">
          <button type="button" onClick={() => onOpenRow(row)} className={ICON_BTN} title={t("openDetail")} aria-label={t("openDetailAria", { title: row.title })}>
            <Maximize2 size={15} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => onDuplicate(row)}
            disabled={duplicating === row.slug || row.analysis_status === "analyzing"}
            className={ICON_BTN}
            title={row.analysis_status === "analyzing" ? t("stillAnalyzing") : t("duplicateIntoForm")}
            aria-label={t("duplicateAria", { title: row.title })}
          >
            {duplicating === row.slug ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Copy size={15} aria-hidden />}
          </button>
          {isUnlinked(row) ? (
            <RowIngest row={row} reload={reload} onIngested={(jobId) => onIngested(row.slug, jobId)} />
          ) : null}
        </div>
      </td>
    </tr>
  );
}
