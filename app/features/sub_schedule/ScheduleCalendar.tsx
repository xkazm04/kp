"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { LayoutGroup, motion } from "framer-motion";
import { useFormatter, useTranslations } from "next-intl";
import { styleFor, TIMES, type SchedEntry } from "./ScheduleTypes";
import { scheduleGridWeeks } from "@/app/_lib/schedule-slots";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { initials } from "@/app/_lib/initials";

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

  // A dated slot ("YYYY-MM-DD HH:MM") split into its date + hour-bucket parts.
  const slotParts = (dateSlot: string) => {
    const [date = "", time = ""] = dateSlot.split(" ");
    return { date, hour: time.slice(0, 2), time, offHour: time.slice(3) !== "00" };
  };
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
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setWeekIdx((i) => Math.max(0, i - 1))}
          disabled={safeIdx === 0}
          aria-label={tCal("pagerPrev")}
          className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-200 bg-white text-ink transition-colors hover:border-coral/40 disabled:opacity-40"
        >
          <ChevronLeft size={16} aria-hidden />
        </button>
        <p className="text-sm font-semibold text-ink" aria-live="polite">
          {tCal("weekOf", { range: weekRange })}
        </p>
        <button
          type="button"
          onClick={() => setWeekIdx((i) => Math.min(weeks.length - 1, i + 1))}
          disabled={safeIdx >= weeks.length - 1}
          aria-label={tCal("pagerNext")}
          className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-200 bg-white text-ink transition-colors hover:border-coral/40 disabled:opacity-40"
        >
          <ChevronRight size={16} aria-hidden />
        </button>
      </div>

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
            {TIMES.map((t) => {
              const rowHour = t.slice(0, 2);
              return (
                <div key={t} role="row" className="grid grid-cols-[64px_repeat(5,1fr)] border-t border-stone-100">
                  <div role="rowheader" className="px-2 py-3 text-sm text-steel">{t}</div>
                  {week.map((d) => {
                    const here = inCell(d.iso, rowHour);
                    const booked = bookedInCell(d.iso, rowHour);
                    const dated = `${d.iso} ${t}`;
                    return (
                      // Cell is a plain container; the chips below are real buttons. A
                      // full-cell slot picker sits behind them — clicks on empty space
                      // fall through to it. Past days can't take a new booking.
                      <div
                        key={d.iso}
                        role="cell"
                        className={`relative min-h-14 border-l border-stone-100 ${d.past ? "bg-stone-50" : ""}`}
                      >
                        <button
                          type="button"
                          onClick={() => onPickSlot(dated)}
                          disabled={d.past}
                          aria-label={tCal("assignAria", { slot: `${headerDate(d)} ${t}` })}
                          title={d.past ? tCal("pastDayTitle") : undefined}
                          className="focus-ring absolute inset-0 transition-colors enabled:hover:bg-coral/5 disabled:cursor-not-allowed"
                        />
                        {here.length > 0 ? (
                          <div className="pointer-events-none relative space-y-1 p-1.5">
                            {here.map((e) => {
                              const s = styleFor(e.archetype);
                              const selected = e.id === selectedId;
                              return (
                                <motion.button
                                  key={e.id}
                                  layoutId={reduced ? undefined : `sched-chip-${e.id}`}
                                  transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 42 }}
                                  type="button"
                                  onClick={() => onSelect(e.id)}
                                  aria-pressed={selected}
                                  title={tCal("chipTitle", { name: e.candidateLabel, archetype: enumLabel("archetype", e.archetype), job: e.jobTitle ? ` · ${e.jobTitle}` : "" })}
                                  aria-label={tCal("chipAria", { name: e.candidateLabel, archetype: enumLabel("archetype", e.archetype), job: e.jobTitle ? `, ${e.jobTitle}` : "" })}
                                  className={`focus-ring pointer-events-auto flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-sm font-medium text-white transition-transform dark:hover:-rotate-1 ${s.bg} ${
                                    selected ? "ring-2 ring-coral ring-offset-1 dark:-rotate-2 dark:shadow-sticker-xs" : ""
                                  }`}
                                >
                                  <span
                                    aria-hidden
                                    className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/25 text-[10px]"
                                  >
                                    {initials(e.candidateLabel)}
                                  </span>
                                  <span className="truncate">{e.candidateLabel}</span>
                                </motion.button>
                              );
                            })}
                          </div>
                        ) : null}
                        {booked.length > 0 ? (
                          // Read-only occupied markers. pointer-events-none so a click still
                          // falls through to the slot picker — the collision check on confirm
                          // is the real guard; this is the visible hint.
                          <div className="pointer-events-none relative space-y-1 p-1.5">
                            {booked.map((m) => {
                              const mp = slotParts(m.dateSlot);
                              return (
                                <span
                                  key={m.id}
                                  title={
                                    mp.offHour
                                      ? tCal("bookedOffHourTitle", { name: m.candidateLabel, time: mp.time })
                                      : tCal("bookedTitle", { name: m.candidateLabel })
                                  }
                                  className="flex w-full items-center gap-1 rounded-md border border-dashed border-moss/50 bg-moss/10 px-1.5 py-1 text-sm font-medium text-moss"
                                >
                                  <Check size={12} className="shrink-0" aria-hidden />
                                  {mp.offHour ? <span className="shrink-0 tabular-nums font-semibold">{mp.time}</span> : null}
                                  <span className="truncate">{m.candidateLabel}</span>
                                </span>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
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
