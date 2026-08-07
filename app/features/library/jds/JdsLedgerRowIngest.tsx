"use client";

import { Briefcase, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useIngestJob } from "./jdsHooks";
import type { JdRow } from "./jdsLibrary";

const ICON_BTN =
  "focus-ring inline-grid h-8 w-8 place-items-center rounded-md text-steel transition-colors hover:bg-paper hover:text-coral disabled:opacity-40";

// The per-row "ingest as job" action for an unlinked JD — extracted verbatim from
// LibrarySavedJdsLedger.tsx so that file stays under the 200-line split threshold.
export function RowIngest({ row, reload, onIngested }: { row: JdRow; reload: () => void; onIngested: (jobId: string | null) => void }) {
  const t = useTranslations("library.tab");
  const { state, run } = useIngestJob(row.slug, (jobId) => {
    onIngested(jobId);
    reload();
  });
  return (
    <button
      type="button"
      onClick={run}
      disabled={state === "busy"}
      className={`${ICON_BTN} ${state === "error" ? "text-coral" : "hover:text-coral"}`}
      title={state === "error" ? t("ingestRetryBrief") : t("ingestAsJobBrief")}
      aria-label={t("ingestRowAria", { title: row.title })}
    >
      {state === "busy" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Briefcase size={15} aria-hidden />}
    </button>
  );
}
