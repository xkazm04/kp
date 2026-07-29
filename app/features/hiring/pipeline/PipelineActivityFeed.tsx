"use client";

// The pipeline board's recent-activity feed (bottom of PipelineTab): a failed
// events fetch reads as "couldn't load activity", never as a silent empty feed.
// Split out of PipelineTab.tsx — pure display, driven by props.

import type { PipelineTabTranslator } from "./pipelineTranslator";
import { AlertTriangle } from "lucide-react";
import { EventDot } from "./PipelineShared";
import type { PipelineEvent } from "@/app/features/shared/pipelineTypes";

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
  if (!eventsError && events.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-meta uppercase tracking-wide text-steel">{t("activity")}</h3>
      {/* A failed events fetch shows a low-key note so a broken feed is
          observable and never masquerades as "no activity yet". */}
      {eventsError ? (
        <p role="status" className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700">
          <AlertTriangle size={14} className="shrink-0" aria-hidden /> {eventsError}
        </p>
      ) : null}
      {events.length > 0 ? (
        <ol className="divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white shadow-panel">
          {events.slice(0, 12).map((ev) => (
            <li key={ev.id} className="flex items-center gap-3 px-3 py-2 text-base">
              <EventDot kind={ev.kind} />
              <span className="min-w-0 flex-1 truncate text-ink">
                <span className="font-medium">{ev.candidateLabel ?? t("candidateFallback")}</span>{" "}
                <span className="text-steel">{eventVerb(ev)}</span>{" "}
                {ev.jobTitle ? <span className="text-steel">· {ev.jobTitle}</span> : null}
              </span>
              <span className="shrink-0 text-sm text-steel">{relativeTime(ev.createdAt)}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
