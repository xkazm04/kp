"use client";

// The week pager header of ScheduleCalendar: prev/next buttons + the visible
// week's date range. Split out of ScheduleCalendar.tsx to keep the calendar
// file under the 200-line cap.
//
// The two buttons are 44x44 (h-11 w-11), not the 32px they were: they are the only
// way to reach another week, they sit at the top of a scrolling grid, and 32px is
// under every touch-target floor there is.

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { useTranslations } from "next-intl";

export function ScheduleCalendarWeekPager({
  weekRange,
  onPrev,
  onNext,
  atStart,
  atEnd,
  tCal,
}: {
  weekRange: string;
  onPrev: () => void;
  onNext: () => void;
  atStart: boolean;
  atEnd: boolean;
  tCal: ReturnType<typeof useTranslations<"scheduleTab.calendar">>;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={onPrev}
        disabled={atStart}
        aria-label={tCal("pagerPrev")}
        className="focus-ring inline-flex h-11 w-11 items-center justify-center rounded-md border border-stone-200 bg-white text-ink transition-colors hover:border-coral/40 disabled:opacity-40"
      >
        <ChevronLeft size={16} aria-hidden />
      </button>
      <p className="text-sm font-semibold text-ink" aria-live="polite">
        {tCal("weekOf", { range: weekRange })}
      </p>
      <button
        type="button"
        onClick={onNext}
        disabled={atEnd}
        aria-label={tCal("pagerNext")}
        className="focus-ring inline-flex h-11 w-11 items-center justify-center rounded-md border border-stone-200 bg-white text-ink transition-colors hover:border-coral/40 disabled:opacity-40"
      >
        <ChevronRight size={16} aria-hidden />
      </button>
    </div>
  );
}
