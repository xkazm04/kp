"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LayoutGroup } from "framer-motion";
import { useFormatter, useTranslations } from "next-intl";
import type { SchedEntry } from "./ScheduleTypes";
import { interviewGridRows, scheduleGridWeeks } from "@/app/_lib/schedule-slots";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { slotParts } from "./scheduleCalendarSlotParts";
import { ScheduleCalendarWeekPager } from "./ScheduleCalendarWeekPager";
import { ScheduleCalendarCell } from "./ScheduleCalendarCell";

// One shared week grid holding every pending interview, now anchored to CONCRETE
// calendar dates instead of weekday columns: a pager walks real weeks across the offer
// horizon (scheduleGridWeeks — bounded by SLOT_HORIZON_DAYS), the headers read "Tue 22
// Jul", and a pick resolves to the DISPLAYED date. Two different real Tuesdays no longer
// collapse into one column, and a booking renders exactly once — in its true week.
//
// Picks + booked markers speak the dated "YYYY-MM-DD HH:MM" grammar (interview zone).
// Each candidate sits in their picked cell; selecting a candidate and clicking a cell
// re-proposes that dated slot. A coral ring marks the currently selected candidate.
//
// Motion: each chip carries a `layoutId`, so re-proposing glides the chip to the new
// cell. The grid scrolls horizontally on narrow viewports, so gradient edge-fades hint
// the Fri column is off-screen. Both snap static under the OS "reduce motion" preference.
export function ScheduleCalendar({
  entries,
  picks,
  bookedMarkers = [],
  selectedId,
  onSelect,
  onPickSlot,
}: {
  entries: SchedEntry[];
  // entry id → dated slot "YYYY-MM-DD HH:MM" (interview zone).
  picks: Record<string, string>;
  // Read-only confirmed bookings from the invite engine (self- or recruiter-booked),
  // rendered as occupied cells so the grid reflects one source of truth. Each marker
  // carries its DATED slot, so it shows only in the week that actually contains it.
  bookedMarkers?: { id: string; dateSlot: string; candidateLabel: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPickSlot: (slot: string) => void;
}) {
  const tCal = useTranslations("scheduleTab.calendar");
  const format = useFormatter();
  const enumLabel = useEnumLabel();
  const reduced = useReducedMotion();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  // The concrete weeks the grid pages through, computed once so "this week" doesn't jump
  // under the parent's polling. `weekIdx` is the visible page (0 = the week with today).
  const weeks = useMemo(() => scheduleGridWeeks(), []);
  const [weekIdx, setWeekIdx] = useState(0);
  const safeIdx = Math.min(weekIdx, weeks.length - 1);
  const week = weeks[safeIdx] ?? [];

  // Format a calendar date faithfully (its own Y/M/D, independent of the viewer's zone):
  // build the instant at noon UTC and format in UTC, localized by next-intl.
  const headerDate = (d: { year: number; month: number; day: number }) =>
    format.dateTime(new Date(Date.UTC(d.year, d.month - 1, d.day, 12)), {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  const weekRange =
    week.length > 0
      ? `${format.dateTime(new Date(Date.UTC(week[0].year, week[0].month - 1, week[0].day, 12)), { day: "numeric", month: "short", timeZone: "UTC" })} – ${format.dateTime(
          new Date(Date.UTC(week[4].year, week[4].month - 1, week[4].day, 12)),
          { day: "numeric", month: "short", timeZone: "UTC" }
        )}`
      : "";

  // Recompute which edge-fades to show from the scroller's current offset.
  const measure = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft < max - 2 });
  };
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // The hour rows: the configured interview hours + the proposal window, UNIONED with
  // any hour a real booking/pick already occupies — so no booking can land on a row the
  // grid doesn't render (the off-hour-vanish bug, re-openable by KP_INTERVIEW_TIMES).
  const extraHours = useMemo(() => {
    const hs = new Set<string>();
    for (const v of Object.values(picks)) {
      const t = v.split(" ")[1];
      if (t) hs.add(t.slice(0, 2));
    }
    for (const m of bookedMarkers) {
      const t = m.dateSlot.split(" ")[1];
      if (t) hs.add(t.slice(0, 2));
    }
    return [...hs];
  }, [picks, bookedMarkers]);
  const rows = useMemo(() => interviewGridRows(extraHours), [extraHours]);

  const inCell = (dayIso: string, rowHour: string) =>
    entries.filter((e) => {
      const p = slotParts(picks[e.id] ?? "");
      return p.date === dayIso && p.hour === rowHour;
    });
  // A booked marker occupies the grid cell for its HOUR on its true DAY. An OFF-HOUR
  // booking (e.g. an accepted 14:30 proposal) buckets into the 14:00 row of the same
  // day with its true minutes shown — it never matches the wrong day or vanishes.
  const bookedInCell = (dayIso: string, rowHour: string) =>
    bookedMarkers.filter((m) => {
      const p = slotParts(m.dateSlot);
      return p.date === dayIso && p.hour === rowHour;
    });

  const fadeBase = `pointer-events-none absolute inset-y-px w-12 ${reduced ? "" : "transition-opacity duration-200"}`;

  return (
    <div className="relative">
      {/* Week pager — walk real weeks across the offer horizon. */}
      <ScheduleCalendarWeekPager
        weekRange={weekRange}
        onPrev={() => setWeekIdx((i) => Math.max(0, i - 1))}
        onNext={() => setWeekIdx((i) => Math.min(weeks.length - 1, i + 1))}
        atStart={safeIdx === 0}
        atEnd={safeIdx >= weeks.length - 1}
        tCal={tCal}
      />

      <div
        ref={scrollerRef}
        onScroll={measure}
        tabIndex={0}
        className="focus-ring overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-panel"
      >
        <LayoutGroup>
          {/* role="table" gives SR the day×time spatial structure the CSS grid conveys visually. */}
          <div className="min-w-[760px]" role="table" aria-label={tCal("calendarAria")}>
            <div role="row" className="grid grid-cols-[64px_repeat(5,1fr)] border-b border-stone-200 bg-paper text-center text-meta uppercase text-steel">
              <div role="columnheader" className="py-2">
                <span className="sr-only">{tCal("timeColumn")}</span>
              </div>
              {week.map((d) => (
                <div
                  key={d.iso}
                  role="columnheader"
                  className={`py-2 font-semibold ${d.past ? "text-steel/40" : ""}`}
                >
                  {headerDate(d)}
                </div>
              ))}
            </div>
            {rows.map((t) => {
              const rowHour = t.slice(0, 2);
              return (
                <div key={t} role="row" className="grid grid-cols-[64px_repeat(5,1fr)] border-t border-stone-100">
                  <div role="rowheader" className="px-2 py-3 text-sm text-steel">{t}</div>
                  {week.map((d) => (
                    <ScheduleCalendarCell
                      key={d.iso}
                      dayIso={d.iso}
                      dayPast={d.past}
                      dayHeaderLabel={`${headerDate(d)} ${t}`}
                      dated={`${d.iso} ${t}`}
                      here={inCell(d.iso, rowHour)}
                      booked={bookedInCell(d.iso, rowHour)}
                      selectedId={selectedId}
                      onSelect={onSelect}
                      onPickSlot={onPickSlot}
                      reduced={reduced}
                      tCal={tCal}
                      enumLabel={enumLabel}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </LayoutGroup>
      </div>
      <div
        aria-hidden
        className={`${fadeBase} left-px rounded-l-lg bg-gradient-to-r from-white to-transparent ${edges.left ? "opacity-100" : "opacity-0"}`}
      />
      <div
        aria-hidden
        className={`${fadeBase} right-px rounded-r-lg bg-gradient-to-l from-white to-transparent ${edges.right ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}
