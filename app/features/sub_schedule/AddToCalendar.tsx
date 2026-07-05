"use client";

import { useState } from "react";
import { CalendarPlus, ChevronDown, Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { eventDurationMin, googleCalendarUrl, outlookCalendarUrl, type CalendarEvent } from "@/app/_lib/calendar-links";
import { buildIcs, downloadFile } from "@/app/_lib/export-utils";

// Solution Ⓑ surface — a compact "Add to calendar ▾" that opens a menu of one-click
// targets (Google, Outlook, download .ics), all built client-side from the event. No
// OAuth, no server round-trip. The .ics uses the canonical export-utils builder;
// `uid` (the invite token) keeps its event stable so re-adding updates, not duplicates.
export function AddToCalendar({
  event,
  uid,
  filename = "interview.ics",
  triggerClassName,
}: {
  event: CalendarEvent;
  uid?: string;
  filename?: string;
  /** Override the trigger button's look (e.g. a larger button on the candidate card). */
  triggerClassName?: string;
}) {
  const t = useTranslations("scheduleTab.calendar");
  const [open, setOpen] = useState(false);

  const saveIcs = () => {
    const ics = buildIcs({
      uid: uid ?? `kp-${event.start}`,
      start: event.start,
      durationMin: eventDurationMin(event),
      title: event.title,
      description: event.description,
      location: event.location,
      stamp: new Date().toISOString(),
    });
    downloadFile(filename, ics, "text/calendar");
    setOpen(false);
  };

  const menuItem = "focus-ring flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-ink hover:bg-paper";

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={
          triggerClassName ??
          "focus-ring inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-xs font-semibold text-ink hover:border-coral/40"
        }
      >
        <CalendarPlus size={13} aria-hidden /> {t("addToCalendar")} <ChevronDown size={12} className="opacity-60" aria-hidden />
      </button>
      {open ? (
        <>
          <button type="button" aria-hidden tabIndex={-1} onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default" />
          <div className="absolute right-0 z-50 mt-1 w-44 rounded-lg border border-stone-200 bg-white p-1 shadow-pop">
            <a href={googleCalendarUrl(event)} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className={menuItem}>
              <CalendarPlus size={13} className="text-steel" aria-hidden /> {t("google")}
            </a>
            <a href={outlookCalendarUrl(event)} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className={menuItem}>
              <CalendarPlus size={13} className="text-steel" aria-hidden /> {t("outlook")}
            </a>
            <button type="button" onClick={saveIcs} className={menuItem}>
              <Download size={13} className="text-steel" aria-hidden /> {t("downloadIcs")}
            </button>
          </div>
        </>
      ) : null}
    </span>
  );
}
