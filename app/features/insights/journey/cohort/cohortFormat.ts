import type { JourneyCohortOutcome } from "@/app/_lib/journey/types";

export const pct = (k: number, n: number): number => (n ? Math.round((100 * k) / n) : 0);

/** A wait on the calendar clock, in the reader's language: minutes, hours or days. */
export function formatWait(seconds: number, locale: string): string {
  if (!Number.isFinite(seconds)) return "";
  const [value, unit] =
    seconds < 3600 ? [seconds / 60, "minute"] : seconds < 48 * 3600 ? [seconds / 3600, "hour"] : [seconds / 86400, "day"];
  return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "short", maximumFractionDigits: value < 10 ? 1 : 0 }).format(value);
}

/** Outcome tones, on brand tokens so both registers remap them. The two failures (withdrew,
 *  went quiet) are the coral family, coral being "needs you" across the kit: the process lost
 *  these; a rejection is a decision, drawn neutral; hired is moss; a rematch is the dial amber. */
export const OUTCOME_TONE: Record<JourneyCohortOutcome, string> = {
  hired: "bg-moss",
  open: "bg-steel/40",
  rejected: "bg-stone-300",
  rematched: "bg-dial-amber",
  withdrawn: "bg-coral",
  stalled: "bg-coral/40",
};
