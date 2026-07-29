"use client";

import { Check, X } from "lucide-react";
import type { useTranslations } from "next-intl";
import type { RowStatus } from "./jobsIngestAdPanelLogic";

// The per-row bulk-import result list — extracted verbatim from
// JobsIngestAdPanel.tsx so that file stays under the 200-line split threshold.
export function JobsIngestAdPanelResults({
  results,
  t,
}: {
  results: { title: string; status: RowStatus }[];
  t: ReturnType<typeof useTranslations<"jobs.ingest">>;
}) {
  if (results.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1">
      {results.map((r, i) => (
        <li key={i} className="flex items-center gap-1.5 text-sm">
          {r.status === "failed" ? (
            <X size={13} className="shrink-0 text-coral" aria-hidden />
          ) : (
            <Check size={13} className={`shrink-0 ${r.status === "added" ? "text-moss" : "text-steel"}`} aria-hidden />
          )}
          <span className="truncate text-ink">{r.title}</span>
          <span className="ml-auto shrink-0 text-meta uppercase text-steel">
            {r.status === "added" ? t("resAdded") : r.status === "exists" ? t("resExists") : t("resFailed")}
          </span>
        </li>
      ))}
    </ul>
  );
}
