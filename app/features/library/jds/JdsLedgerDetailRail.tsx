"use client";

import Link from "next/link";
import { Briefcase, Copy, ExternalLink, Loader2, Pencil, Sparkles } from "lucide-react";
import type { useTranslations } from "next-intl";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { isUnlinked, shortDate, type JdRow } from "./jdsLibrary";
import { JdCandidateList } from "./JdsCandidateList";
import { AnalyzingChip, StatusBadge } from "./JdsLedgerBadges";
import type { useIngestJob } from "./jdsHooks";

// The detail modal's metadata rail (status, analyzed/saved tiles, action
// buttons, candidate list) — extracted verbatim from JdsLedgerDetailModal.tsx
// so that file stays under the 200-line split threshold.
export function JdsLedgerDetailRail({
  row,
  effRow,
  analyzing,
  canEdit,
  inEdit,
  toggleEdit,
  onDuplicate,
  duplicating,
  ing,
  t,
}: {
  row: JdRow;
  effRow: JdRow;
  analyzing: boolean;
  canEdit: boolean;
  inEdit: boolean;
  toggleEdit: () => void;
  onDuplicate: (row: JdRow) => void;
  duplicating: boolean;
  ing: ReturnType<typeof useIngestJob>;
  t: ReturnType<typeof useTranslations<"library.tab">>;
}) {
  return (
    <aside className="space-y-4">
      <div className="space-y-2">
        <p className={META_LABEL}>{t("colStatus")}</p>
        {analyzing ? (
          <AnalyzingChip />
        ) : (
          <StatusBadge row={effRow} muted={isUnlinked(effRow)} />
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-stone-200 bg-white px-3 py-2 shadow-pop">
          <p className={META_LABEL}>{t("colAnalyzed")}</p>
          <p className="font-serif text-h2 leading-none text-ink nums">{row.analysisCount ?? 0}</p>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white px-3 py-2 shadow-pop">
          <p className={META_LABEL}>{t("colSaved")}</p>
          <p className="mt-1 text-sm font-semibold text-ink">{shortDate(row.created_at)}</p>
        </div>
      </div>
      <div className="space-y-2 border-t border-stone-200 pt-4">
        {canEdit ? (
          <button
            type="button"
            onClick={toggleEdit}
            aria-pressed={inEdit}
            aria-label={t("editJdAria")}
            className={`focus-ring flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold hover:border-coral/40 ${inEdit ? "border-coral/40 bg-coral/5 text-coral" : "border-stone-200 text-ink"}`}
          >
            <Pencil size={15} aria-hidden /> {inEdit ? t("editCancel") : t("editJd")}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onDuplicate(row)}
          disabled={duplicating || analyzing}
          className="focus-ring flex w-full items-center gap-2 rounded-md border border-stone-200 px-3 py-2 text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
        >
          {duplicating ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Copy size={15} aria-hidden />}
          {t("duplicate")}
        </button>
        {isUnlinked(row) ? (
          <button
            type="button"
            onClick={ing.run}
            disabled={ing.state === "busy"}
            className="focus-ring flex w-full items-center gap-2 rounded-md border border-stone-200 px-3 py-2 text-sm font-semibold text-coral hover:bg-coral/5 disabled:opacity-50"
          >
            {ing.state === "busy" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Briefcase size={15} aria-hidden />}
            {ing.state === "error" ? t("ingestRetry") : t("ingestAsJob")}
          </button>
        ) : null}
        <Link href={`/jds/${encodeURIComponent(row.slug)}`} className="focus-ring flex w-full items-center gap-2 rounded-md border border-stone-200 px-3 py-2 text-sm font-semibold text-ink hover:border-coral/40">
          <ExternalLink size={15} aria-hidden /> {t("detailOpenPublic")}
        </Link>
        <Link href={`/?tab=analyze&jd=${encodeURIComponent(row.slug)}`} className="focus-ring flex w-full items-center gap-2 rounded-md bg-ink px-3 py-2 text-sm font-semibold text-white hover:bg-steel">
          <Sparkles size={15} aria-hidden /> {t("detailAnalyzeCv")}
        </Link>
      </div>
      <div className="space-y-2 border-t border-stone-200 pt-4">
        <p className={META_LABEL}>{t("candidatesToggle", { count: row.analysisCount ?? 0 })}</p>
        <JdCandidateList slug={row.slug} count={row.analysisCount ?? 0} />
      </div>
    </aside>
  );
}
