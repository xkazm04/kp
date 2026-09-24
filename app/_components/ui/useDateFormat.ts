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
import { DATE_SHAPES, parseDateInput, type DateFormatOptions, type DateFormatters, type DateInput } from "./dateShapes";
export type { DateInput, DateFormatOptions, DateFormatters } from "./dateShapes";

/** next-intl narrows `Intl.DateTimeFormatOptions` (its `timeZoneName` drops the
 *  offset variants), so the option bags below are typed from the formatter that
 *  consumes them rather than from the DOM lib. */
type DateTimeOptions = NonNullable<Parameters<ReturnType<typeof useFormatter>["dateTime"]>[2]>;

export function useDateFormat(): DateFormatters {
  const format = useFormatter();
  return useMemo(() => {
    const shape =
      (options: DateTimeOptions) =>
      (value: DateInput, opts?: DateFormatOptions): string => {
        const d = parseDateInput(value);
        if (!d) return opts?.fallback ?? "—";
        return format.dateTime(d, opts?.timeZone ? { ...options, timeZone: opts.timeZone } : options);
      };
    return {
      date: shape(DATE_SHAPES.date),
      dateTime: shape(DATE_SHAPES.dateTime),
      dayTime: shape(DATE_SHAPES.dayTime),
      time: shape(DATE_SHAPES.time),
    };
  }, [format]);
}
