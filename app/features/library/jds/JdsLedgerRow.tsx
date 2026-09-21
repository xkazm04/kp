"use client";

import { Copy, History, Loader2, Maximize2, Users } from "lucide-react";
import { useLocale } from "next-intl";
import type { useTranslations } from "next-intl";
import { isUnlinked, shortDate, statusCategory, type JdRow } from "./jdsLibrary";
import { AnalyzingChip, SeniorityCell, StatusBadge } from "./JdsLedgerBadges";
import { RowIngest } from "./JdsLedgerRowIngest";
import { RowDelete } from "./JdsLedgerRowDelete";

const ICON_BTN =
  "focus-ring inline-grid h-8 w-8 place-items-center rounded-md text-steel transition-colors hover:bg-paper hover:text-coral disabled:opacity-40";

// One saved-JD table row — extracted verbatim from JdsLedgerTable.tsx so that
// file stays under the 200-line split threshold.
export function JdsLedgerRow({
  row,
  enumLabel,
  reload,
  duplicating,
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
  return (
    <tr className="group transition-colors hover:bg-paper">
      {/* Role. Width-capped so the table fits its panel instead of scrolling the
          row actions off-screen; the cap grew when the Pipeline column left. The
          full title stays available via the tooltip and the detail modal. */}
      <td className="px-3 py-2.5 align-middle">
        <button
          type="button"
          onClick={() => onOpenRow(row)}
          className="focus-ring block max-w-[24rem] truncate text-left text-sm font-semibold text-ink hover:text-coral"
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
          {/* Delete. TWO conditions, and both are the server's own: `canDelete` is
              the authority fold (creator or admin) that GET /api/jds computed for
              this reader, and a LIVE role is never deletable from the library — the
              description belongs to an opening candidates are applying to, and
              closing the role on the Roles tab is the move that comes first. A row
              that fails either test shows NOTHING rather than a disabled icon: an
              action a reader can never take is noise in a ledger they scan. */}
          {row.canDelete && statusCategory(row) !== "live" ? <RowDelete row={row} reload={reload} /> : null}
        </div>
      </td>
    </tr>
  );
}
