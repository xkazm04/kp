/** The date shapes shared by client hooks, server components, and plain .ts code. */
export const DATE_SHAPES = {
  date: { dateStyle: "medium" },
  dateTime: { dateStyle: "medium", timeStyle: "short" },
  dayTime: { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" },
  time: { timeStyle: "short" },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

export type DateShape = keyof typeof DATE_SHAPES;
export type DateInput = string | number | Date | null | undefined;
export interface DateFormatOptions {
  fallback?: string;
  timeZone?: string;
}
export type DateFormatters = Record<DateShape, (value: DateInput, opts?: DateFormatOptions) => string>;

export function parseDateInput(value: DateInput): Date | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Use where React's locale-aware hook cannot run. Pass the reader's locale. */
export function createDateFormatters(locale: string): DateFormatters {
  const cache = new Map<string, Intl.DateTimeFormat>();
  const shape = (name: DateShape) => (value: DateInput, opts?: DateFormatOptions): string => {
    const date = parseDateInput(value);
    if (!date) return opts?.fallback ?? "—";
    const key = `${name}:${opts?.timeZone ?? ""}`;
    let formatter = cache.get(key);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat(locale, { ...DATE_SHAPES[name], ...(opts?.timeZone ? { timeZone: opts.timeZone } : {}) });
      cache.set(key, formatter);
    }
    return formatter.format(date);
  };
  return { date: shape("date"), dateTime: shape("dateTime"), dayTime: shape("dayTime"), time: shape("time") };
}
