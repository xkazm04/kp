"use client";

// One day×hour grid cell in ScheduleCalendar: the slot-picker button, the
// candidate chips assigned to this cell, and any read-only booked markers.
// Split out of ScheduleCalendar.tsx to keep the calendar file under the
// 200-line cap.

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import type { useTranslations } from "next-intl";
import { styleFor, type SchedEntry } from "./ScheduleTypes";
import { initials } from "@/app/_lib/initials";
import { slotParts } from "./scheduleCalendarSlotParts";

export function ScheduleCalendarCell({
  dayIso,
  dayPast,
  dayHeaderLabel,
  dated,
  here,
  booked,
  selectedId,
  onSelect,
  onPickSlot,
  reduced,
  tCal,
  enumLabel,
}: {
  dayIso: string;
  dayPast: boolean;
  dayHeaderLabel: string;
  dated: string;
  here: SchedEntry[];
  booked: { id: string; dateSlot: string; candidateLabel: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPickSlot: (slot: string) => void;
  reduced: boolean;
  tCal: ReturnType<typeof useTranslations<"scheduleTab.calendar">>;
  enumLabel: (kind: string, value: string | null) => string;
}) {
  return (
    // Cell is a plain container; the chips below are real buttons. A
    // full-cell slot picker sits behind them — clicks on empty space
    // fall through to it. Past days can't take a new booking.
    <div
      key={dayIso}
      role="cell"
      className={`relative min-h-14 border-l border-stone-100 ${dayPast ? "bg-stone-50" : ""}`}
    >
      <button
        type="button"
        onClick={() => onPickSlot(dated)}
        disabled={dayPast}
        aria-label={tCal("assignAria", { slot: dayHeaderLabel })}
        title={dayPast ? tCal("pastDayTitle") : undefined}
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
}
