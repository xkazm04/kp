"use client";

// Shared candidate summary used by both the Pending and Interviewed lists on
// ScheduleTab: the truncated label + job title + archetype dot/label on the
// left, and the score (plus any list-specific `trailing` node, e.g. the
// proposed slot chip) on the right. Split out of ScheduleTab.tsx so a tweak
// here provably changes both lists.

import type { ReactNode } from "react";
import { styleFor, type SchedEntry } from "./ScheduleTypes";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { useEnumLabel } from "@/app/_lib/use-enum-label";

export function CandidateCardHeader({ entry, trailing }: { entry: SchedEntry; trailing?: ReactNode }) {
  const enumLabel = useEnumLabel();
  const s = styleFor(entry.archetype);
  const archLabel = enumLabel("archetype", entry.archetype);
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">{entry.candidateLabel}</span>
        <span className="block truncate text-sm text-steel">{entry.jobTitle}</span>
        <span className="mt-1 inline-flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.bg}`} title={archLabel} aria-hidden />
          <span className="text-meta uppercase tracking-wide text-steel">{archLabel}</span>
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1.5">
        <ScoreBadge score={entry.matchScore} />
        {trailing}
      </span>
    </>
  );
}
