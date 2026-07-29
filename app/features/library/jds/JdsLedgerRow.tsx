"use client";

import { Copy, Loader2, Maximize2, Users } from "lucide-react";
import type { useTranslations } from "next-intl";
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
  onOpenRow,
  onDuplicate,
  onIngested,
  t,
}: {
  row: JdRow;
  enumLabel: (cat: string, value: string | null | undefined) => string;
  reload: () => void;
  duplicating: string | null;
  onOpenRow: (row: JdRow) => void;
  onDuplicate: (row: JdRow) => void;
  onIngested: (slug: string, jobId: string | null) => void;
  t: ReturnType<typeof useTranslations<"library.tab">>;
}) {
  const analyzed = row.analysisCount ?? 0;
  return (
    <tr className="group transition-colors hover:bg-paper">
      <td className="px-4 py-2.5 align-middle">
        <button
          type="button"
          onClick={() => onOpenRow(row)}
          className="focus-ring block max-w-[26rem] truncate text-left text-sm font-semibold text-ink hover:text-coral"
          title={row.title}
        >
          {row.title}
        </button>
      </td>
      <td className="px-4 py-2.5 align-middle text-sm text-steel">
        {row.roleFamily ? enumLabel("family", row.roleFamily) : <span className="text-stone-400">—</span>}
      </td>
      <td className="px-4 py-2.5 align-middle">
        <SeniorityCell value={row.seniority} />
      </td>
      <td className="px-4 py-2.5 align-middle">
        {row.analysis_status === "analyzing" ? (
          <AnalyzingChip />
        ) : (
          <StatusBadge row={row} muted={isUnlinked(row)} />
        )}
      </td>
      <td className="px-4 py-2.5 align-middle">
        <span className={`inline-flex items-center gap-1.5 text-sm ${analyzed ? "text-ink" : "text-stone-400"}`}>
          <Users size={14} aria-hidden />
          <span className="nums font-semibold">{analyzed}</span>
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 align-middle text-sm text-steel">{shortDate(row.created_at)}</td>
      <td className="px-4 py-2.5 align-middle">
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
