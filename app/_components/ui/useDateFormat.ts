"use client";

/*
 * The app's date shapes, in the reader's language.
 *
 * Two idioms were running side by side: 41 raw `toLocaleDateString()` /
 * `new Intl.DateTimeFormat(locale, …)` calls in 30 files, and `useFormatter()`
 * from next-intl in 5. They are not equivalent — a bare `toLocaleDateString()`
 * reads the OS locale, not the one the reader picked in the app, so a Czech
 * operator on an English machine got English dates next to Czech prose. Even
 * the `new Intl.DateTimeFormat(locale, …)` half, which does read the app
 * locale, re-picked the option bag at every call site: `dateStyle: "medium"`
 * here, `{ day: "numeric", month: "short", year: "numeric" }` there, so the
 * same date wore two shapes on two surfaces.
 *
 * This hook is the one idiom: next-intl's formatter (which is locale- and
 * time-zone-aware and shares its Intl instances through the intl context)
 * behind the app's small vocabulary of date shapes.
 *
 * Every shape is null-safe. Dates arrive from the store as ISO strings that can
 * be absent or malformed, and "Invalid Date" in a candidate card is the failure
 * these guards exist to prevent; `fallback` (default "—") is what renders
 * instead.
 */

import { useFormatter } from "next-intl";
import { useMemo } from "react";

/** Anything a store row or an API payload can hand us for a moment in time. */
export type DateInput = string | number | Date | null | undefined;

/** next-intl narrows `Intl.DateTimeFormatOptions` (its `timeZoneName` drops the
 *  offset variants), so the option bags below are typed from the formatter that
 *  consumes them rather than from the DOM lib. */
type DateTimeOptions = NonNullable<Parameters<ReturnType<typeof useFormatter>["dateTime"]>[2]>;

export interface DateFormatOptions {
  /** Rendered when the value is absent or unparseable. Default "—". */
  fallback?: string;
  /** IANA zone. Omit to render in the viewer's zone (the right default for
   *  everything except an invite showing the CANDIDATE's local time). */
  timeZone?: string;
}

export interface DateFormatters {
  /** "3 Sep 2026" — the default for a timestamp whose time of day is noise
   *  (created, updated, analyzed, expires). */
  date: (value: DateInput, opts?: DateFormatOptions) => string;
  /** "3 Sep 2026, 14:30" — a timestamp where the time of day matters. */
  dateTime: (value: DateInput, opts?: DateFormatOptions) => string;
  /** "Thu 3 Sep, 14:30" — an appointment: the weekday leads, the year is
   *  implied by proximity. The schedule surfaces' shape. */
  dayTime: (value: DateInput, opts?: DateFormatOptions) => string;
  /** "14:30" — a time inside a row that already names its day. */
  time: (value: DateInput, opts?: DateFormatOptions) => string;
}

/** Parse to a Date, or null when there is nothing renderable. */
function toDate(value: DateInput): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function useDateFormat(): DateFormatters {
  const format = useFormatter();
  return useMemo(() => {
    const shape =
      (options: DateTimeOptions) =>
      (value: DateInput, opts?: DateFormatOptions): string => {
        const d = toDate(value);
        if (!d) return opts?.fallback ?? "—";
        return format.dateTime(d, opts?.timeZone ? { ...options, timeZone: opts.timeZone } : options);
      };
    return {
      date: shape({ dateStyle: "medium" }),
      dateTime: shape({ dateStyle: "medium", timeStyle: "short" }),
      dayTime: shape({ weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
      time: shape({ timeStyle: "short" }),
    };
  }, [format]);
}
