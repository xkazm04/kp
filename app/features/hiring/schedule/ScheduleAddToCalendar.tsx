"use client";

import { useRef, useState } from "react";
import { CalendarPlus, ChevronDown, Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { eventDurationMin, googleCalendarUrl, outlookCalendarUrl, type CalendarEvent } from "@/app/_lib/calendar-links";
import { buildIcs, downloadFile } from "@/app/_lib/export-utils";
// bug-ui-scan-2026-07-09 (interview-scheduling-prep-rubric #4) — shared dismissal
// primitive (Escape-to-close, focus-return, outside-press without a click-eating
// viewport blanket), replacing this component's hand-rolled `fixed inset-0` button.
import { BTN_SECONDARY, PANEL } from "@/app/_components/ui/recipes";
import { usePopoverDismiss } from "./useSchedulePopoverDismiss";

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
  const triggerRef = useRef<HTMLButtonElement>(null);
  // bug-ui-scan-2026-07-09 (interview-scheduling-prep-rubric #4): Escape + outside-
  // press dismissal that returns focus to the trigger, instead of a viewport blanket.
  const containerRef = usePopoverDismiss<HTMLSpanElement>({ open, onClose: () => setOpen(false), triggerRef });

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
    <span ref={containerRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={
          triggerClassName ??
          `${BTN_SECONDARY} bg-white px-2 py-1 text-meta normal-case`
        }
      >
        <CalendarPlus size={13} aria-hidden /> {t("addToCalendar")} <ChevronDown size={12} className="opacity-60" aria-hidden />
      </button>
      {open ? (
        // role=menu + menuitem so AT announces a menu, not loose links. Dismissal
        // (Escape / outside press) is handled by usePopoverDismiss — no blanket button.
        <div role="menu" className={`${PANEL} absolute right-0 z-50 mt-1 w-44 p-1 shadow-pop`}>
          <a role="menuitem" href={googleCalendarUrl(event)} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className={menuItem}>
            <CalendarPlus size={13} className="text-steel" aria-hidden /> {t("google")}
          </a>
          <a role="menuitem" href={outlookCalendarUrl(event)} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className={menuItem}>
            <CalendarPlus size={13} className="text-steel" aria-hidden /> {t("outlook")}
          </a>
          <button role="menuitem" type="button" onClick={saveIcs} className={menuItem}>
            <Download size={13} className="text-steel" aria-hidden /> {t("downloadIcs")}
          </button>
        </div>
      ) : null}
    </span>
  );
}
