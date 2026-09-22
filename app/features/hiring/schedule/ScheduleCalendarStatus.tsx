"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import type { CalendarStatus } from "@/app/_lib/calendar/free-busy";
import { buildUrl, clearedTabScopedParams } from "@/app/features/shell/tabs";
import { useShellNavigate } from "@/app/features/shell/nav/shallow-nav";

type SlotsStatus = { calendarStatus: CalendarStatus; droppedForConflict: number };

/** The recruiter's free/busy verdict, from the same slot offer used to reschedule. */
export function ScheduleCalendarStatus() {
  const t = useTranslations("scheduleTab.lifecycle");
  const tCalendar = useTranslations("integrations.calendar");
  const nav = useShellNavigate();
  const search = useSearchParams();
  const { data } = useJsonFetch<SlotsStatus>("/api/schedule?slots=1");
  if (!data?.calendarStatus) return null;
  return (
    <div role="status" className="flex w-fit flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-stone-200 bg-paper px-3 py-1.5 text-sm text-steel">
      <span>
        {t(`calendarStatus.${data.calendarStatus}`)}
        {data.droppedForConflict > 0 ? ` · ${t("calendarDropped", { count: data.droppedForConflict })}` : null}
      </span>
      {/* The two statuses a click fixes get the click: connect a calendar, or reconnect a
          dead grant. `unavailable` is a wait, so it offers nothing to press. */}
      {data.calendarStatus === "not_connected" || data.calendarStatus === "needs_reconnect" ? (
        <button type="button" onClick={() => nav.push(buildUrl({ ...clearedTabScopedParams(), tab: "integrations" }, search.toString()))} className="focus-ring font-semibold text-coral hover:underline">
          {data.calendarStatus === "needs_reconnect" ? tCalendar("grant.reconnectAction") : tCalendar("connect")}
        </button>
      ) : null}
    </div>
  );
}
