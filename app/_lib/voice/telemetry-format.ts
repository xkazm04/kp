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

/** A seconds span as a compact "12m 30s" / "8m" / "45s" label, or null when the
 *  span is unknown (no timestamps) — never fabricate a duration. */
export function formatSpokenDuration(sec: number | null): string | null {
  if (sec === null || !Number.isFinite(sec) || sec < 0) return null;
  const whole = Math.round(sec);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}
