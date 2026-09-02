"use client";

import { Briefcase, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useIngestJob } from "./jdsHooks";
import type { JdRow } from "./jdsLibrary";

const ICON_BTN =
  "focus-ring inline-grid h-8 w-8 place-items-center rounded-md text-steel transition-colors hover:bg-paper hover:text-coral disabled:opacity-40";

// The per-row "ingest as job" action for an unlinked JD — extracted verbatim from
// LibrarySavedJdsLedger.tsx so that file stays under the 200-line split threshold.
export function RowIngest({ row, reload, onIngested }: { row: JdRow; reload: () => void; onIngested: (jobId: string | null) => void }) {
  const t = useTranslations("library.tab");
  // The route answers with a machine `code`; the reader gets it in their language
  // (app/_lib/use-error-message.ts). The row has no room for a sentence beside an
  // icon button, so the resolved reason rides the tooltip AND an assertive live
  // region — before this the failure was a colour change and a fixed "Couldn't
  // ingest. Retry." for every cause, announced to nobody.
  const errMsg = useErrorMessage();
  const { state, code, run } = useIngestJob(row.slug, (jobId) => {
    onIngested(jobId);
    reload();
  });
  const reason = state === "error" ? errMsg({ code }, t("ingestRetryBrief")) : null;
  return (
    <>
      <button
        type="button"
        onClick={run}
        disabled={state === "busy"}
        className={`${ICON_BTN} ${state === "error" ? "text-coral" : "hover:text-coral"}`}
        title={reason ?? t("ingestAsJobBrief")}
        aria-label={t("ingestRowAria", { title: row.title })}
      >
        {state === "busy" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Briefcase size={15} aria-hidden />}
      </button>
      {reason ? (
        <span role="alert" className="sr-only">
          {reason}
        </span>
      ) : null}
    </>
  );
}
