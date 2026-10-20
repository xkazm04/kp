// The analytics_targets key space — ONE registry, derived from the workspace's own
// stage axis plus the reserved keys.
//
// One table (analytics_targets: metric -> value) holds three kinds of setting: a
// conversion % goal per funnel stage, a time-to-hire goal in days, and the two ROI
// inputs (recruiter hourly rate in CZK, the manual hours-per-hire baseline). Until
// this module the key space was kept three times by hand: the save route validated
// against the SHIPPED five stage names while the funnel and the goals editor spoke
// the workspace's own axis (so a team that added a column was shown a goal field it
// could never save), the ceilings were a route-local ternary, the store's read split
// had no axis check (a retired column's goal rode the payload as a phantom stage),
// and the client mirrored the reserved keys as string literals.
//
// Pure on purpose: no DB, no Next, no React — the client re-exports the reserved
// keys from here (AnalyticsTypes.ts) without pulling better-sqlite3, the route
// validates through it, and db/analytics.ts filters the payload through it.
import type { StageDef } from "./pipeline-stages";

// 82c2b8e8 — a time-to-hire goal in DAYS.
export const TIME_TO_HIRE_TARGET_KEY = "time_to_hire";
// b39992b1 — the org's recruiter hourly cost (CZK) for the automation ROI figure. Not a
// goal, but it rides the same key/value table and save route.
export const RECRUITER_HOURLY_TARGET_KEY = "recruiter_hourly_czk";
// UAT KAT-L1-005 — the org's OWN manual hours-per-hire baseline for the ROI claim.
export const MANUAL_HOURS_TARGET_KEY = "manual_hours_per_hire";

export type TargetKind = "conversion" | "days" | "czk" | "hours";
export type TargetKeySpec = { kind: TargetKind; max: number };

/** A conversion goal is a percentage. */
export const CONVERSION_TARGET_MAX = 100;

/** Every analytics_targets key that is NOT a funnel-stage conversion goal, with its
 *  unit and sanity ceiling (ceilings are input sanity, not business rules). Adding a
 *  reserved key here makes it settable (route), excluded from the conversion map
 *  (store) and exportable to the client in one place — rule M3. */
export const RESERVED_TARGET_SPECS: Readonly<Record<string, TargetKeySpec>> = {
  [TIME_TO_HIRE_TARGET_KEY]: { kind: "days", max: 3650 },
  [RECRUITER_HOURLY_TARGET_KEY]: { kind: "czk", max: 1_000_000 },
  [MANUAL_HOURS_TARGET_KEY]: { kind: "hours", max: 1000 },
};

/** DERIVED from the spec table, never hand-listed. */
export const RESERVED_TARGET_KEYS: ReadonlySet<string> = new Set(Object.keys(RESERVED_TARGET_SPECS));

type AxisStage = Pick<StageDef, "id">;

/** The live stage ids that can carry a conversion goal: every live column except the
 *  first. The first column is the entry column on every valid axis (the axis
 *  validator requires it to open the board) and has no inbound conversion — the
 *  funnel's conversionPct is null at index 0 — so a goal for it could never be
 *  judged. Retired columns are not on `axis` at all. */
export function conversionGoalStages(axis: readonly AxisStage[]): string[] {
  return axis.slice(1).map((s) => s.id).filter((id) => !RESERVED_TARGET_KEYS.has(id));
}

/** The spec for `metric` on this LIVE axis, or null when it is not a goal key here
 *  (unknown, retired, or the entry column). Reserved keys win over a stage id that
 *  happens to spell the same. */
export function targetKeySpec(metric: string, axis: readonly AxisStage[]): TargetKeySpec | null {
  const reserved = RESERVED_TARGET_SPECS[metric];
  if (reserved) return reserved;
  return conversionGoalStages(axis).includes(metric) ? { kind: "conversion", max: CONVERSION_TARGET_MAX } : null;
}

export type TargetWriteRefusal = "ANALYTICS_TARGET_UNKNOWN_METRIC" | "ANALYTICS_TARGET_OUT_OF_RANGE";
export type TargetWriteVerdict =
  | { ok: true; metric: string; value: number | null }
  | { ok: false; code: TargetWriteRefusal };

/** Validate one goal write against the live axis. A null/empty value clears the goal
 *  (the store also clears on any non-positive value). A value that is not a finite,
 *  non-negative number, or is over the key's ceiling, is OUT_OF_RANGE. */
export function validateTargetWrite(body: { metric?: unknown; value?: unknown }, axis: readonly AxisStage[]): TargetWriteVerdict {
  const metric = String(body.metric ?? "").trim();
  const spec = metric ? targetKeySpec(metric, axis) : null;
  if (!spec) return { ok: false, code: "ANALYTICS_TARGET_UNKNOWN_METRIC" };
  const raw = body.value;
  if (raw == null || raw === "") return { ok: true, metric, value: null };
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > spec.max) return { ok: false, code: "ANALYTICS_TARGET_OUT_OF_RANGE" };
  return { ok: true, metric, value };
}

/** The conversion goals the payload may carry: stored rows whose key is a goal key on
 *  the LIVE axis. A goal for a retired column stays in the table (un-retiring the
 *  column brings it back unchanged) but is withheld here rather than leaked as a
 *  phantom stage. */
export function liveConversionTargets(all: Iterable<[string, number]>, axis: readonly AxisStage[]): Record<string, number> {
  const live = new Set(conversionGoalStages(axis));
  const conversion: Record<string, number> = {};
  for (const [metric, value] of all) {
    if (live.has(metric)) conversion[metric] = value;
  }
  return conversion;
}
