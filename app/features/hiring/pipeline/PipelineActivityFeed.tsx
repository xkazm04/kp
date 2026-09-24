"use client";

// The pipeline board's recent-activity feed (bottom of PipelineTab): the last
// SEVEN DAYS of events, newest first, twenty to a page, with the candidate's full
// name (the feed reads the operator-gated /api/pipeline/events/recent — the public
// events route serves initials by design). A failed events fetch reads as
// "couldn't load activity", never as a silent empty feed. Split out of
// PipelineTab.tsx — display over props, plus the page it is on.

import { useMemo, useState } from "react";
import { useLocale } from "next-intl";
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
  onOpenEntry,
}: {
  t: PipelineTabTranslator;
  eventsError: string | null;
  events: PipelineEvent[];
  eventVerb: (ev: PipelineEvent) => string;
  relativeTime: (at: string) => string;
  onOpenEntry: (id: string) => void | Promise<void>;
}) {
  const [page, setPage] = useState(0);
  const [kind, setKind] = useState<string | null>(null);
  const locale = useLocale();
  // The window's floor, fixed at mount (a lazy initializer is the one place the
  // clock may be read without making render impure). The server already bounds
  // what it serves; this guards the in-memory tail the poll keeps prepending to.
  // A tab left open past midnight over-includes by the session's age at most —
  // the next visit remounts the feed and re-cuts the week.
  const [from] = useState(() => new Date(Date.now() - WINDOW_MS).toISOString());
  const recent = useMemo(() => events.filter((ev) => ev.createdAt >= from), [events, from]);
  const kindOptions = useMemo(() => {
    const byKind = new Map<string, PipelineEvent>();
    for (const event of recent) if (!byKind.has(event.kind)) byKind.set(event.kind, event);
    return [...byKind.entries()].map(([value, event]) => ({ value, label: eventVerb({ ...event, detail: null }) }))
      .sort((a, b) => a.label.localeCompare(b.label, locale));
  }, [recent, eventVerb, locale]);
  const selectedKind = kindOptions.some((option) => option.value === kind) ? kind : null;
  const filtered = selectedKind ? recent.filter((event) => event.kind === selectedKind) : recent;
  const safePage = clampPage(page, filtered.length);
  const shown = pageSlice(filtered, safePage);

  if (!eventsError && recent.length === 0) return null;
  return (
    <section aria-labelledby="pipeline-activity" className={`${PANEL} overflow-hidden`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 bg-paper px-4 py-2">
        <h3 id="pipeline-activity" className="flex items-center gap-2 text-meta uppercase tracking-wide text-steel">
          <History size={14} className="text-steel" aria-hidden /> {t("activity")}
        </h3>
        <span className={`${CHIP_QUIET} ml-auto normal-case tracking-normal`}>{t("activityWindow")}</span>
        {kindOptions.length > 1 ? (
          <label className="flex items-center gap-1.5 text-sm text-steel">
            {t("activityKindLabel")}
            <select value={selectedKind ?? ""} onChange={(event) => { setKind(event.target.value || null); setPage(0); }} className="focus-ring rounded-md border border-stone-200 bg-white px-2 py-1 text-sm text-ink">
              <option value="">{t("activityAllKinds")}</option>
              {kindOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        ) : null}
      </div>
      {eventsError ? (
        <p role="status" className="flex items-center gap-1.5 border-b border-stone-200 bg-amber-50 px-4 py-2 text-base font-medium text-amber-700">
          <AlertTriangle size={15} className="shrink-0" aria-hidden /> {eventsError}
        </p>
      ) : null}
      {shown.length > 0 ? (
        <ol className="divide-y divide-stone-200">
          {shown.map((ev) => {
            const entryId = ev.entryId;
            const content = <>
              <EventDot kind={ev.kind} />
              <span className="min-w-0 flex-1 truncate text-ink">
                <span className="font-medium">{ev.candidateLabel ?? t("candidateFallback")}</span>{" "}
                <span className="text-steel">{eventVerb(ev)}</span>{" "}
                {ev.jobTitle ? <span className="text-steel">· {ev.jobTitle}</span> : null}
              </span>
              <span className="shrink-0 text-sm text-steel nums">{relativeTime(ev.createdAt)}</span>
            </>;
            return (
              <li key={ev.id}>
                {entryId ? (
                  <button type="button" onClick={() => void onOpenEntry(entryId)} className="focus-ring flex w-full items-center gap-3 px-4 py-2.5 text-left text-base hover:bg-paper">
                    {content}
                  </button>
                ) : (
                  <div className="flex items-center gap-3 px-4 py-2.5 text-base">{content}</div>
                )}
              </li>
            );
          })}
        </ol>
      ) : null}
      {filtered.length > 0 ? (
        <div className="border-t border-stone-200 px-4 py-2">
          <TablePager page={safePage} total={filtered.length} onPage={setPage} />
        </div>
      ) : null}
    </section>
  );
}
