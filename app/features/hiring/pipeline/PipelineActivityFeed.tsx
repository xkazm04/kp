"use client";

// The pipeline board's recent-activity feed (bottom of PipelineTab): the last
// SEVEN DAYS of events, newest first, twenty to a page, with the candidate's full
// name (the feed reads the operator-gated /api/pipeline/events/recent — the public
// events route serves initials by design). A failed events fetch reads as
// "couldn't load activity", never as a silent empty feed. Split out of
// PipelineTab.tsx — display over props, plus the page it is on.

import { useMemo, useState } from "react";
import type { PipelineTabTranslator } from "./pipelineTranslator";
import { AlertTriangle, History } from "lucide-react";
import { clampPage, pageSlice, TablePager } from "@/app/_components/table/TablePager";
import { CHIP_QUIET, PANEL } from "@/app/_components/ui/recipes";
import { EventDot } from "./PipelineShared";
import type { PipelineEvent } from "@/app/features/shared/pipelineTypes";

const WINDOW_MS = 7 * 86_400_000;

export function PipelineActivityFeed({
  t,
  eventsError,
  events,
  eventVerb,
  relativeTime,
}: {
  t: PipelineTabTranslator;
  eventsError: string | null;
  events: PipelineEvent[];
  eventVerb: (ev: PipelineEvent) => string;
  relativeTime: (at: string) => string;
}) {
  const [page, setPage] = useState(0);
  // The window's floor, fixed at mount (a lazy initializer is the one place the
  // clock may be read without making render impure). The server already bounds
  // what it serves; this guards the in-memory tail the poll keeps prepending to.
  // A tab left open past midnight over-includes by the session's age at most —
  // the next visit remounts the feed and re-cuts the week.
  const [from] = useState(() => new Date(Date.now() - WINDOW_MS).toISOString());
  const recent = useMemo(() => events.filter((ev) => ev.createdAt >= from), [events, from]);
  const safePage = clampPage(page, recent.length);
  const shown = pageSlice(recent, safePage);

  if (!eventsError && recent.length === 0) return null;
  return (
    <section aria-labelledby="pipeline-activity" className={`${PANEL} overflow-hidden`}>
      <h3
        id="pipeline-activity"
        className="flex items-center gap-2 border-b border-stone-200 bg-paper px-4 py-2 text-meta uppercase tracking-wide text-steel"
      >
        <History size={14} className="text-steel" aria-hidden />
        {t("activity")}
        <span className={`${CHIP_QUIET} ml-auto normal-case tracking-normal`}>{t("activityWindow")}</span>
      </h3>
      {eventsError ? (
        <p role="status" className="flex items-center gap-1.5 border-b border-stone-200 bg-amber-50 px-4 py-2 text-base font-medium text-amber-700">
          <AlertTriangle size={15} className="shrink-0" aria-hidden /> {eventsError}
        </p>
      ) : null}
      {shown.length > 0 ? (
        <ol className="divide-y divide-stone-200">
          {shown.map((ev) => (
            <li key={ev.id} className="flex items-center gap-3 px-4 py-2.5 text-base">
              <EventDot kind={ev.kind} />
              <span className="min-w-0 flex-1 truncate text-ink">
                <span className="font-medium">{ev.candidateLabel ?? t("candidateFallback")}</span>{" "}
                <span className="text-steel">{eventVerb(ev)}</span>{" "}
                {ev.jobTitle ? <span className="text-steel">· {ev.jobTitle}</span> : null}
              </span>
              <span className="shrink-0 text-sm text-steel nums">{relativeTime(ev.createdAt)}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {recent.length > 0 ? (
        <div className="border-t border-stone-200 px-4 py-2">
          <TablePager page={safePage} total={recent.length} onPage={setPage} />
        </div>
      ) : null}
    </section>
  );
}
