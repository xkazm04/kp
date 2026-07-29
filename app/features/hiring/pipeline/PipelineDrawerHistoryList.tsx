"use client";

// PIPE3/c6524f2f — the drawer's merged history: pipeline events + cross-store
// timeline chapters, time-ordered. Split out of PipelineCandidateDrawer.tsx.

import { History } from "lucide-react";
import { useTranslations } from "next-intl";
import type { CandidateTimelineItem, RematchLink } from "@/app/_lib/candidate-timeline";
import type { PipelineEvent } from "@/app/features/shared/pipelineTypes";
import { EventDot, useEventVerb, useRelativeTime } from "./PipelineShared";
import { isRematchKind } from "@/app/features/shared/pipelineRematchLink";
import { PipelineRematchAffordance } from "./PipelineRematchAffordance";
import { PipelineTimelineItemRow } from "./PipelineTimelineItemRow";

type Row =
  | { at: string; key: string; type: "event"; ev: PipelineEvent }
  | { at: string; key: string; type: "extra"; item: CandidateTimelineItem };

export function PipelineDrawerHistoryList({
  mergedHistory,
  rematchLinks,
  onOpenEntry,
}: {
  mergedHistory: Row[];
  rematchLinks: Record<number, RematchLink>;
  onOpenEntry?: (entryId: string) => void;
}) {
  const t = useTranslations("pipeline.drawer");
  const eventVerb = useEventVerb();
  const relativeTime = useRelativeTime();
  if (mergedHistory.length === 0) return null;
  return (
    <div>
      <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
        <History size={13} /> {t("history")}
      </p>
      <ol className="mt-2 space-y-1.5">
        {mergedHistory.map((row) =>
          row.type === "event" ? (
            <li key={row.key} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5">
                <EventDot kind={row.ev.kind} />
              </span>
              <span className="min-w-0 flex-1 text-ink">
                {eventVerb(row.ev)}
                {/* rematch-story-navigable — a re-engagement event carries the
                    counterpart entry in its detail; render it as a link only
                    when the counterpart still resolves (server-side check),
                    else honest non-link text. */}
                {isRematchKind(row.ev.kind) ? (
                  <PipelineRematchAffordance link={rematchLinks[row.ev.id]} onOpenEntry={onOpenEntry} />
                ) : null}
              </span>
              <span className="shrink-0 text-meta text-steel">{relativeTime(row.ev.createdAt)}</span>
            </li>
          ) : (
            <li key={row.key} className="flex items-start gap-2 text-sm">
              <PipelineTimelineItemRow item={row.item} />
              <span className="shrink-0 text-meta text-steel">{relativeTime(row.item.at)}</span>
            </li>
          )
        )}
      </ol>
    </div>
  );
}
