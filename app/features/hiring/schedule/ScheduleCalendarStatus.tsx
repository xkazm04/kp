"use client";

import { useTranslations } from "next-intl";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import type { CalendarStatus } from "@/app/_lib/calendar/free-busy";

type SlotsStatus = { calendarStatus: CalendarStatus; droppedForConflict: number };

/** The recruiter's free/busy verdict, from the same slot offer used to reschedule. */
export function ScheduleCalendarStatus() {
  const t = useTranslations("scheduleTab.lifecycle");
  const { data } = useJsonFetch<SlotsStatus>("/api/schedule?slots=1");
  if (!data?.calendarStatus) return null;
  return (
    <p role="status" className="w-fit rounded-md border border-stone-200 bg-paper px-3 py-1.5 text-sm text-steel">
      {t(`calendarStatus.${data.calendarStatus}`)}
      {data.droppedForConflict > 0 ? ` · ${t("calendarDropped", { count: data.droppedForConflict })}` : null}
    </p>
  );
}
