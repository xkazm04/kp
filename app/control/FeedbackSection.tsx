"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { LoadStatus } from "@/app/_components/LoadStatus";
import { useLoader } from "@/app/_lib/useLoader";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import type { FeedbackRow } from "@/app/_lib/feedback-store";

// Read-only recruiter-feedback list for the control room. Its own small file on
// purpose: ControlRoom.tsx is already oversized and mid-decomposition — this
// section composes BESIDE it (mounted from app/control/page.tsx), never grows it.
// Same load conventions as the room: useLoader + LoadStatus, one fetch on mount
// (feedback is not live telemetry, so no poll).

export function FeedbackSection() {
  const t = useTranslations("feedback.control");
  const rel = useRelativeTime();
  const { data, state, reload } = useLoader<FeedbackRow[]>(
    "/api/feedback",
    (p) => ((p as { feedback?: FeedbackRow[] }).feedback ?? []),
    []
  );
  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <section className="mt-6">
      <h2 className="text-meta uppercase tracking-wide text-steel">{t("title")}</h2>
      <p className="mt-1 max-w-2xl text-[11px] text-steel">{t("intro")}</p>
      <LoadStatus state={state} label={t("title")} className="mt-2" />
      {data.length === 0 ? (
        <p className="mt-2 rounded-md border border-dashed border-stone-200 p-3 text-xs text-steel">{t("empty")}</p>
      ) : (
        <ul className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white shadow-panel">
          {data.map((row) => (
            <li key={row.id} className="px-3 py-2 text-xs">
              <p className="whitespace-pre-wrap text-ink">{row.message}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-steel">
                <span>{rel(row.createdAt)}</span>
                {row.email ? <span className="font-medium">{row.email}</span> : null}
                {row.route ? <span className="font-mono">{row.route}</span> : null}
                {row.appVersion ? <span>{t("version", { version: row.appVersion })}</span> : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
