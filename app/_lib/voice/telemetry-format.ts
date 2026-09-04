import type { InterviewTelemetry } from "../interview-telemetry";

// Presentational projections of interview telemetry — pure, browser-safe, and
// unit-pinned so the transcript modal and the compare grid render the SAME
// numbers the same way. These are DESCRIPTIVE signals (word shares, timestamp
// gaps), never scores; the UI labels say so and the formatting stays neutral.

/** Candidate share of all spoken words as a whole percent (0..100), or null
 *  when nobody spoke (telemetry.talkRatio is null). */
export function talkSharePercent(t: InterviewTelemetry): number | null {
  return t.talkRatio === null ? null : Math.round(t.talkRatio * 100);
}

/** A seconds span split into whole minutes and the remaining seconds. */
export type SpokenDuration = { m: number; s: number };

/** A seconds span as renderable PARTS, or null when the span is unknown (no
 *  timestamps) — never fabricate a duration.
 *
 *  This used to return the string `12m 30s`, which three telemetry strips printed
 *  verbatim into all four locales. The units belong to the catalog: a caller
 *  renders `t("duration", formatSpokenDuration(sec))` and the ICU message picks
 *  the minutes-and-seconds / minutes-only / seconds-only shape in the reader's
 *  language. Nothing in this module knows how a minute is spelled — pinned by the
 *  source guard in the colocated test. */
export function formatSpokenDuration(sec: number | null): SpokenDuration | null {
  if (sec === null || !Number.isFinite(sec) || sec < 0) return null;
  const whole = Math.round(sec);
  return { m: Math.floor(whole / 60), s: whole % 60 };
}
