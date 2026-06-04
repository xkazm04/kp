// Pure, dependency-free schema + policy for the Phase 3 decision rules. Kept in
// its own module (no `better-sqlite3`, no `@/`-aliased imports) so the validator
// and the small-cohort rounding policy can be exercised directly by Node's
// built-in test runner — see decision-config-schema.test.ts — AND imported into
// the client `DecisionRulesModal` without dragging the DB into the browser
// bundle. The persistence layer (decision-config-store.ts) and the route
// boundary (api/decisions/config) both validate writes through here, and
// screen-wave.ts reads the rounding policy from here, so the contract has ONE
// source of truth.

// Screening auto-reject: drop the bottom `rejectBottomPercent` of a role's
// matched candidates that are ALSO below `maxMatchToReject` match — never
// early-career. Off by default (opt-in), like the automation clock.
export type ScreeningRule = {
  autoRejectEnabled: boolean;
  rejectBottomPercent: number; // 0–100
  maxMatchToReject: number; // 0–100 match score
};

export const SCREENING_DEFAULT: ScreeningRule = {
  autoRejectEnabled: false,
  rejectBottomPercent: 20,
  maxMatchToReject: 45,
};

// The phases that have a known, validated config schema today. A write to any
// other phase is rejected at the boundary rather than persisted into a row that
// `getAllDecisionConfigs` would never read back anyway.
export const KNOWN_DECISION_PHASES = ["screening"] as const;
export type DecisionPhase = (typeof KNOWN_DECISION_PHASES)[number];

const SCREENING_KEYS = ["autoRejectEnabled", "rejectBottomPercent", "maxMatchToReject"] as const;

export type DecisionConfigResult =
  | { ok: true; phase: DecisionPhase; config: ScreeningRule }
  | { ok: false; error: string };

// Thrown by the persistence backstop (setDecisionConfig) when an unvalidated
// config reaches the write boundary. The route maps it to a 400; everywhere else
// it surfaces the contract violation loudly instead of silently persisting it.
export class DecisionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionConfigError";
  }
}

function clampPercent(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/**
 * Validate a decision-config write against its phase schema.
 *
 * Two distinct failure modes, deliberately handled differently:
 *   • MALFORMED (wrong type, stray key, missing field, NaN/Infinity, non-object,
 *     unknown phase) → rejected with a descriptive error. The caller turns this
 *     into a 400; nothing is persisted.
 *   • OUT-OF-RANGE but coercible numbers (e.g. 9999, -5) → CLAMPED to 0–100 and
 *     accepted. These mirror the modal's input clamps, which the API used to
 *     bypass entirely (idea-55baa5da).
 *
 * On success returns the clamped, fully-typed config — never the raw body — so
 * the persisted JSON can only ever contain the three known fields.
 */
export function validateDecisionConfig(phase: unknown, rawConfig: unknown): DecisionConfigResult {
  if (typeof phase !== "string" || !(KNOWN_DECISION_PHASES as readonly string[]).includes(phase)) {
    return {
      ok: false,
      error: `Unknown decision phase "${String(phase)}". Known phases: ${KNOWN_DECISION_PHASES.join(", ")}.`,
    };
  }
  if (typeof rawConfig !== "object" || rawConfig === null || Array.isArray(rawConfig)) {
    return { ok: false, error: "config must be a plain object." };
  }
  // "screening" is the only known phase today; KNOWN_DECISION_PHASES gates entry.
  return validateScreeningRule(rawConfig as Record<string, unknown>);
}

function validateScreeningRule(raw: Record<string, unknown>): DecisionConfigResult {
  const stray = Object.keys(raw).filter((k) => !(SCREENING_KEYS as readonly string[]).includes(k));
  if (stray.length > 0) {
    return { ok: false, error: `Unknown screening rule field(s): ${stray.join(", ")}.` };
  }
  if (typeof raw.autoRejectEnabled !== "boolean") {
    return { ok: false, error: "autoRejectEnabled must be a boolean." };
  }
  for (const field of ["rejectBottomPercent", "maxMatchToReject"] as const) {
    const v = raw[field];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return { ok: false, error: `${field} must be a finite number.` };
    }
  }
  return {
    ok: true,
    phase: "screening",
    config: {
      autoRejectEnabled: raw.autoRejectEnabled,
      rejectBottomPercent: clampPercent(raw.rejectBottomPercent as number),
      maxMatchToReject: clampPercent(raw.maxMatchToReject as number),
    },
  };
}

/**
 * SMALL-COHORT POLICY for the screening auto-reject "bottom %" selection.
 *
 * `rejectBottomPercent` of a cohort of `n` rarely lands on a whole candidate.
 * The old `Math.floor((n * pct) / 100)` rounded DOWN, so any pool small enough
 * that the bottom-% came to less than one whole candidate rounded to 0 — the
 * default 20% over n=4 is floor(0.8)=0 — and that role was SILENTLY exempt from
 * an automation the recruiter had explicitly switched on (idea-582ff3b2).
 *
 * DECISION — floor, with a MINIMUM OF 1 in any non-empty cohort whenever a
 * positive percentage is configured. Rationale:
 *   • It targets the actual bug: the only behavior change versus the old floor
 *     is that a small pool can no longer round down to zero. Larger pools are
 *     untouched (n=10 @ 20% is 2 either way).
 *   • "Reject the bottom X%" should mean "act on the weakest", and the weakest
 *     of any non-empty pool is one candidate — not zero. `ceil` was rejected as
 *     too aggressive (it adds a candidate to large pools too); plain `round`
 *     still rounds the smallest pools (n≤2 @ 20%) to zero, leaving the bug.
 *   • It is not over-eager: the selected candidate is still only auto-rejected
 *     if they ALSO fall below `maxMatchToReject`, so a strong-but-small pool
 *     rejects nobody. A configured 0% (or empty cohort) still selects nobody.
 *
 * Mirrored verbatim in DecisionRulesModal's plain-English rule sentence so the
 * configured percentage matches what actually executes.
 */
export function screenBottomCount(cohortSize: number, rejectBottomPercent: number): number {
  if (cohortSize <= 0 || rejectBottomPercent <= 0) return 0;
  return Math.max(1, Math.floor((cohortSize * rejectBottomPercent) / 100));
}
