// The scheduler control's pure state machine, lifted out of the hook and the
// toolbar so it can be tested without React (schedulerRunState.test.ts).
//
// WHY THIS FILE EXISTS. The automation clock's ON pill rendered `sched.enabled`
// — a stored FLAG saying the clock is ARMED. Whether the tick loop is still
// ALIVE is a different signal entirely: app/_lib/scheduler-health.ts has judged
// it from the heartbeat since bug-ui-scan-2026-07-09, but only /api/health and
// /api/ops ever read it. So the one surface an operator uses to control the
// clock showed a green "On" over a chain that had stopped ticking hours ago,
// while the ops panel next door said "stalled". `livenessChip` +
// `enabledPillTone` are the mapping that closes that: armed is armed, alive is
// alive, and the two are rendered separately.
//
// Everything here is pure and import-free at runtime (the two imports are
// `import type`, erased before Node sees the file) so the unit runner loads it
// directly.

import type { SchedulerLiveness } from "@/app/_lib/scheduler-health";
import type { RunResult, Summary, Tick } from "./SchedulerSummaryBadges";

// ── Liveness ───────────────────────────────────────────────────────────────

/** Tone + catalog key for the liveness chip beside the ON/OFF pill. `null`
 *  means "render nothing". */
export type LivenessChip = { tone: "ok" | "warn" | "danger"; labelKey: "liveHealthy" | "liveStarting" | "liveStalled" };

const CHIP_BY_LIVENESS: Record<SchedulerLiveness, LivenessChip> = {
  healthy: { tone: "ok", labelKey: "liveHealthy" },
  starting: { tone: "warn", labelKey: "liveStarting" },
  stalled: { tone: "danger", labelKey: "liveStalled" },
};

/**
 * What the liveness chip should say, if anything.
 *
 * Two deliberate silences:
 *  - a DISARMED clock reports no liveness. "Off" is already the whole truth and
 *    a "stalled" badge beside it would read as a fault rather than a choice.
 *  - a `null`/absent liveness (an older server, or a payload that predates the
 *    field) renders nothing rather than guessing. Absence of evidence is not
 *    evidence of a stall — the ops probe owns that verdict.
 */
export function livenessChip(
  enabled: boolean,
  liveness: SchedulerLiveness | null | undefined
): LivenessChip | null {
  if (!enabled) return null;
  if (!liveness) return null;
  return CHIP_BY_LIVENESS[liveness];
}

/** How the ON/OFF pill itself should be toned. `degraded` is the case that did
 *  not exist before: ARMED, but the clock is not ticking — the pill must not be
 *  moss-green there, or the chip beside it is arguing with it. */
export function enabledPillTone(
  enabled: boolean,
  liveness: SchedulerLiveness | null | undefined
): "on" | "off" | "degraded" {
  if (!enabled) return "off";
  if (liveness && liveness !== "healthy") return "degraded";
  return "on";
}

// ── Tick outcome ───────────────────────────────────────────────────────────

/** The four-plus buckets a policy pass moves entries into, in display order.
 *  THE one table: SummaryBadges adds tone + icon on top of it and describeTick
 *  reads it directly, so a fifth outcome is a single-line change that cannot
 *  leave the badge row and the "Run now" chip out of sync. */
export const SUMMARY_BUCKETS: { key: keyof Summary; labelKey: string }[] = [
  { key: "advanced", labelKey: "summaryAdvanced" },
  { key: "rejected", labelKey: "summaryRejected" },
  { key: "held", labelKey: "summaryHeld" },
  { key: "alerts", labelKey: "summaryAlerts" },
  { key: "errors", labelKey: "summaryErrors" },
];

// Minimal structural shape of a next-intl translator, the `labelOr` idiom from
// app/_lib/use-enum-label.ts: generic so any namespace's translator satisfies it
// without this module coupling to one, with the loose string key cast inside.
type AnyTranslator = { (key: never, values?: never): string };

/** Turn a tick outcome into a short, legible chip: the real summary on success,
 *  a neutral no-op, or the error verbatim (it is an uncoded server exception —
 *  the localized sentence carries it, it does not replace it). */
export function describeTick<T extends AnyTranslator>(tick: Tick, t: T): RunResult {
  const tr = (key: string, values?: Record<string, unknown>) =>
    (t as unknown as (k: string, v?: Record<string, unknown>) => string)(key, values);
  if (tick.error) return { tone: "error", text: tick.error };
  if (!tick.ran) return { tone: "neutral", text: tr("nothingDue") };
  const s = tick.summary ?? {};
  const parts = SUMMARY_BUCKETS.filter(({ key }) => s[key]).map(({ key, labelKey }) =>
    tr(labelKey, { n: s[key] ?? 0 })
  );
  return { tone: "ok", text: parts.length ? tr("ranWith", { parts: parts.join(", ") }) : tr("ranNoChanges") };
}

// ── Interval field ─────────────────────────────────────────────────────────

/** The cadence window the engine honors. Mirrored by the input's min/max. */
export const INTERVAL_MIN_MINUTES = 1;
export const INTERVAL_MAX_MINUTES = 1440;

/** Parse, round and clamp the interval draft to [1, 1440]. Empty / 0 / negative
 *  / NaN mean "no change" and snap back to `current`, so the field never shows a
 *  value the engine will not honor and a stray keystroke cannot persist a 0. */
export function clampInterval(raw: string, current: number): number {
  const parsed = Number(raw);
  const base = Number.isFinite(parsed) && parsed > 0 ? parsed : current;
  return Math.max(INTERVAL_MIN_MINUTES, Math.min(INTERVAL_MAX_MINUTES, Math.round(base)));
}

// ── Poll cadence ───────────────────────────────────────────────────────────

/** The healthy poll cadence — matches the board's own 30s tick. */
export const POLL_BASE_MS = 30_000;
/** The ceiling a failing poll backs off to. Five minutes: long enough that a
 *  down engine is not being hammered, short enough that a recovered one is
 *  noticed without a reload (and a visibility change resets to the base). */
export const POLL_MAX_MS = 5 * 60_000;

/** Exponential backoff on consecutive read failures: 30s → 60s → 2m → 4m → 5m
 *  (capped). The old loop retried a failing GET at a flat 30s forever, so an
 *  unreachable engine meant 120 failing requests an hour per open tab. One
 *  success resets the counter, so the curve costs nothing when things work. */
export function nextPollDelay(consecutiveFailures: number): number {
  const n = Math.max(0, Math.floor(consecutiveFailures));
  return Math.min(POLL_MAX_MS, POLL_BASE_MS * 2 ** Math.min(n, 10));
}
