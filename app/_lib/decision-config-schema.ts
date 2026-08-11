// Pure, dependency-free schema + policy for the Phase 3 decision rules. Kept in
// its own module (no `better-sqlite3`, no `@/`-aliased imports) so the validator
// and the small-cohort rounding policy can be exercised directly by Node's
// built-in test runner — see decision-config-schema.test.ts — AND imported into
// the client `DecisionRulesModal` without dragging the DB into the browser
// bundle. The persistence layer (decision-config-store.ts) and the route
// boundary (api/decisions/config) both validate writes through here, and
// screen-wave.ts reads the rounding policy from here, so the contract has ONE
// source of truth.

import { DEFAULT_REGIME_ID, REGIME_IDS, type RegimeId } from "./compliance-regimes.ts";
import { ROLE_FAMILY_SLUGS } from "./role-families.ts";

// Screening auto-reject: drop the bottom `rejectBottomPercent` of a role's
// matched candidates that are ALSO below `maxMatchToReject` match — never
// early-career. Off by default (opt-in), like the automation clock.
//
// PER-FAMILY FLOORS (family-floors): per-family reliability is measured and a
// per-family recommendation is computable, but the screening floor used to be a
// single GLOBAL knob — so the per-family view could only inform, never act.
// `familyFloors` is an OPTIONAL map role_family → maxMatchToReject override, each
// bounded by the exact same 0–100 validation as the global value. ABSENT (the
// default) means the global floor applies to every family, so the shipped default
// is byte-identical to before this field existed (see effectiveFloor).
export type ScreeningRule = {
  autoRejectEnabled: boolean;
  rejectBottomPercent: number; // 0–100
  maxMatchToReject: number; // 0–100 match score
  familyFloors?: Record<string, number>; // role_family → maxMatchToReject override (0–100)
  /** CALIBRATION HOLDOUT — the percentage of would-be auto-rejects that are spared
   *  and allowed to proceed, so their outcomes are uncontaminated by the score that
   *  would have rejected them (UAT 2026-07-20, KAT-L1-001/002).
   *
   *  Why this exists: calibration pairs the match score against an outcome label
   *  where `rejected` counts as a negative — but the screening wave PRODUCES that
   *  rejection by testing the score against a floor. The predictor causes its own
   *  label, so a perfectly biased screener that favoured polished CVs would still
   *  draw a near-perfect reliability curve. Every accuracy claim is unfalsifiable
   *  until some below-floor candidates are observed WITHOUT the score acting on them.
   *
   *  This is the clean arm. 0 disables it (calibration then stays circular). */
  holdoutPercent?: number; // 0–100
};

/** The auto-reject floor that actually applies to a candidate: the family override
 *  when this role family carries one, else the global `maxMatchToReject`. A null /
 *  unknown family, or a family with no override, always resolves to the global value,
 *  so the pre-family-floors behavior is preserved byte-for-byte. Pure + total. */
export function effectiveFloor(cfg: ScreeningRule, roleFamily: string | null | undefined): number {
  const override = roleFamily && cfg.familyFloors ? cfg.familyFloors[roleFamily] : undefined;
  return typeof override === "number" && Number.isFinite(override) ? override : cfg.maxMatchToReject;
}

export const SCREENING_DEFAULT: ScreeningRule = {
  autoRejectEnabled: false,
  rejectBottomPercent: 20,
  maxMatchToReject: 45,
};

/** Share of would-be auto-rejects spared as the calibration clean arm when a rule
 *  doesn't state one. Deliberately NOT a key in SCREENING_DEFAULT: the persisted
 *  rule shape is pinned "byte-identical, no phantom key" by the config tests, and a
 *  saved rule from before the holdout existed must keep validating unchanged.
 *  Resolved at point of use via `effectiveHoldoutPercent` instead. */
export const DEFAULT_HOLDOUT_PERCENT = 5;

/** The holdout rate actually in force. An absent value takes the default (an old
 *  saved rule still gets a clean arm); an explicit 0 disables it, which is how a
 *  workspace opts out. Non-finite / negative fails closed to 0 — a malformed config
 *  must never spare an unbounded share of a wave. */
export function effectiveHoldoutPercent(cfg: ScreeningRule): number {
  const raw = cfg.holdoutPercent;
  if (raw === undefined || raw === null) return DEFAULT_HOLDOUT_PERCENT;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return 0;
  return Math.min(100, raw);
}

// P1-1 — the active compliance JURISDICTION (workspace setting). Drives the
// candidate AI-disclosure framing + the recruiter compliance posture. Defaults to
// "eu", which reproduces the app's pre-P1-1 GDPR framing exactly.
export type ComplianceRule = {
  jurisdiction: RegimeId;
};

export const COMPLIANCE_DEFAULT: ComplianceRule = {
  jurisdiction: DEFAULT_REGIME_ID,
};

// The hiring-pipeline plan (Settings → Hiring): which interview rounds run and
// where a human approves. Persisted per workspace through the same tiered
// decision-config store; consumed (eventually) by the pipeline action layer —
// see docs/concepts/interview-rounds.md. The stored shape carries NO round ids
// (those are UI list keys, minted on load by the composer model).
export type InterviewPlanGate = "auto" | "human";
export type InterviewPlanRoundKind = "ai" | "human";
export type InterviewPlanRound = {
  kind: InterviewPlanRoundKind;
  /** Who ratifies the round's verdict. A HUMAN round is always human-gated by
   *  definition — the validator normalizes it so a stored plan can't claim an
   *  unattended human interview. */
  gate: InterviewPlanGate;
  /** Cohort reducer INTO this round (top N of the previous round's advancers);
   *  null = everyone. Always null on the first round. */
  topN: number | null;
};
export type InterviewPlanRule = {
  screeningGate: InterviewPlanGate;
  rounds: InterviewPlanRound[];
  offerGate: InterviewPlanGate;
};

export const INTERVIEW_PLAN_MAX_ROUNDS = 3;

/** Does the plan run at least one round of this kind? Drives which Schedule
 *  surfaces (AI docket / human calendar) are live for the workspace. Pure —
 *  shared by the client tab and the server routing. */
export function planHasRound(plan: InterviewPlanRule, kind: InterviewPlanRoundKind): boolean {
  return plan.rounds.some((r) => r.kind === kind);
}

/** The hybrid handoff rule: after an AI round's scorecard is ACCEPTED, does a
 *  HUMAN round still follow in the plan? True → the accept routes the candidate
 *  back to the calendar gate (human-round scheduling) instead of advancing
 *  toward Offer. Anchored on the FIRST ai round — the product runs one AI round
 *  today; a second AI round would need a per-entry round pointer to sequence. */
export function planRoutesAiScorecardToHumanRound(plan: InterviewPlanRule): boolean {
  const aiIdx = plan.rounds.findIndex((r) => r.kind === "ai");
  if (aiIdx === -1) return false;
  return plan.rounds.slice(aiIdx + 1).some((r) => r.kind === "human");
}

/** Default = the team-hybrid archetype: gated AI round, then a human round for
 *  the top 3, everything human-approved. */
export const INTERVIEW_PLAN_DEFAULT: InterviewPlanRule = {
  screeningGate: "human",
  rounds: [
    { kind: "ai", gate: "human", topN: null },
    { kind: "human", gate: "human", topN: 3 },
  ],
  offerGate: "human",
};

// The phases that have a known, validated config schema today. A write to any
// other phase is rejected at the boundary rather than persisted into a row that
// `getAllDecisionConfigs` would never read back anyway.
export const KNOWN_DECISION_PHASES = ["screening", "compliance", "interviewPlan"] as const;
export type DecisionPhase = (typeof KNOWN_DECISION_PHASES)[number];

const SCREENING_KEYS = ["autoRejectEnabled", "rejectBottomPercent", "maxMatchToReject", "familyFloors", "holdoutPercent"] as const;
const COMPLIANCE_KEYS = ["jurisdiction"] as const;
const INTERVIEW_PLAN_KEYS = ["screeningGate", "rounds", "offerGate"] as const;
const INTERVIEW_PLAN_ROUND_KEYS = ["kind", "gate", "topN"] as const;

export type DecisionConfigResult =
  | { ok: true; phase: "screening"; config: ScreeningRule }
  | { ok: true; phase: "compliance"; config: ComplianceRule }
  | { ok: true; phase: "interviewPlan"; config: InterviewPlanRule }
  | { ok: false; error: string };

export type ScreeningOverrideResult =
  | { ok: true; override: Partial<ScreeningRule> }
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
  // KNOWN_DECISION_PHASES gated entry above; dispatch to the per-phase validator.
  if (phase === "compliance") return validateComplianceRule(rawConfig as Record<string, unknown>);
  if (phase === "interviewPlan") return validateInterviewPlan(rawConfig as Record<string, unknown>);
  return validateScreeningRule(rawConfig as Record<string, unknown>);
}

const isGate = (v: unknown): v is InterviewPlanGate => v === "auto" || v === "human";

function validateInterviewPlan(raw: Record<string, unknown>): DecisionConfigResult {
  const stray = Object.keys(raw).filter((k) => !(INTERVIEW_PLAN_KEYS as readonly string[]).includes(k));
  if (stray.length > 0) return { ok: false, error: `interviewPlan: unknown key(s) ${stray.join(", ")}.` };
  if (!isGate(raw.screeningGate)) return { ok: false, error: "interviewPlan.screeningGate must be 'auto' or 'human'." };
  if (!isGate(raw.offerGate)) return { ok: false, error: "interviewPlan.offerGate must be 'auto' or 'human'." };
  if (!Array.isArray(raw.rounds)) return { ok: false, error: "interviewPlan.rounds must be an array." };
  if (raw.rounds.length > INTERVIEW_PLAN_MAX_ROUNDS) {
    return { ok: false, error: `interviewPlan.rounds is capped at ${INTERVIEW_PLAN_MAX_ROUNDS}.` };
  }
  const rounds: InterviewPlanRound[] = [];
  for (const [i, r] of raw.rounds.entries()) {
    if (typeof r !== "object" || r === null || Array.isArray(r)) {
      return { ok: false, error: `interviewPlan.rounds[${i}] must be an object.` };
    }
    const rec = r as Record<string, unknown>;
    const strayR = Object.keys(rec).filter((k) => !(INTERVIEW_PLAN_ROUND_KEYS as readonly string[]).includes(k));
    if (strayR.length > 0) return { ok: false, error: `interviewPlan.rounds[${i}]: unknown key(s) ${strayR.join(", ")}.` };
    if (rec.kind !== "ai" && rec.kind !== "human") {
      return { ok: false, error: `interviewPlan.rounds[${i}].kind must be 'ai' or 'human'.` };
    }
    if (!isGate(rec.gate)) return { ok: false, error: `interviewPlan.rounds[${i}].gate must be 'auto' or 'human'.` };
    let topN: number | null = null;
    if (rec.topN !== null && rec.topN !== undefined) {
      if (typeof rec.topN !== "number" || !Number.isFinite(rec.topN)) {
        return { ok: false, error: `interviewPlan.rounds[${i}].topN must be a number or null.` };
      }
      // Out-of-range but coercible → clamp (same posture as the 0–100 fields).
      topN = Math.max(1, Math.min(50, Math.round(rec.topN)));
    }
    rounds.push({
      kind: rec.kind,
      // A human round's verdict IS the human decision — never persist it as
      // unattended, whatever the client sent.
      gate: rec.kind === "human" ? "human" : rec.gate,
      // The first round has no previous cohort to reduce.
      topN: i === 0 ? null : topN,
    });
  }
  return { ok: true, phase: "interviewPlan", config: { screeningGate: raw.screeningGate, rounds, offerGate: raw.offerGate } };
}

function validateComplianceRule(raw: Record<string, unknown>): DecisionConfigResult {
  const stray = Object.keys(raw).filter((k) => !(COMPLIANCE_KEYS as readonly string[]).includes(k));
  if (stray.length > 0) {
    return { ok: false, error: `Unknown compliance rule field(s): ${stray.join(", ")}.` };
  }
  const j = raw.jurisdiction;
  if (typeof j !== "string" || !(REGIME_IDS as readonly string[]).includes(j)) {
    return { ok: false, error: `jurisdiction must be one of: ${REGIME_IDS.join(", ")}.` };
  }
  return { ok: true, phase: "compliance", config: { jurisdiction: j as RegimeId } };
}

/**
 * Validate the OPTIONAL per-family floor map. Same trust-boundary guarantees as the
 * global value, applied per entry: keys MUST be known role families (an unknown
 * family is rejected, not silently kept — the map stays bounded), values MUST be
 * finite numbers, and present out-of-range numbers are CLAMPED to 0–100 exactly like
 * `maxMatchToReject`. An ABSENT map returns `value: undefined` so the caller omits
 * the field entirely — keeping a plain screening rule byte-identical to before this
 * field existed (the shipped-default deepEqual tests depend on that).
 */
function validateFamilyFloors(
  raw: unknown
): { ok: true; value: Record<string, number> | undefined } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "familyFloors must be a plain object mapping role family → floor." };
  }
  const out: Record<string, number> = {};
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(ROLE_FAMILY_SLUGS as readonly string[]).includes(key)) {
      return { ok: false, error: `Unknown role family in familyFloors: "${key}". Known families: ${ROLE_FAMILY_SLUGS.join(", ")}.` };
    }
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return { ok: false, error: `familyFloors.${key} must be a finite number.` };
    }
    out[key] = clampPercent(v);
  }
  return { ok: true, value: out };
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
  // holdoutPercent is OPTIONAL (like familyFloors): every rule saved before the
  // calibration holdout existed must keep validating unchanged, and an absent value
  // resolves via effectiveHoldoutPercent at point of use. Validated only when present.
  if (raw.holdoutPercent !== undefined) {
    if (typeof raw.holdoutPercent !== "number" || !Number.isFinite(raw.holdoutPercent)) {
      return { ok: false, error: "holdoutPercent must be a finite number." };
    }
  }
  const floors = validateFamilyFloors(raw.familyFloors);
  if (!floors.ok) return { ok: false, error: floors.error };
  const config: ScreeningRule = {
    autoRejectEnabled: raw.autoRejectEnabled,
    rejectBottomPercent: clampPercent(raw.rejectBottomPercent as number),
    maxMatchToReject: clampPercent(raw.maxMatchToReject as number),
  };
  // Only carry familyFloors when it was present — an absent map keeps the persisted
  // JSON (and a deepEqual against SCREENING_DEFAULT) byte-identical to before.
  if (floors.value !== undefined) config.familyFloors = floors.value;
  // Same "no phantom key" contract for the holdout rate.
  if (raw.holdoutPercent !== undefined) config.holdoutPercent = clampPercent(raw.holdoutPercent as number);
  return { ok: true, phase: "screening", config };
}

/**
 * Validate the OPTIONAL per-run `override` accepted by /api/decisions/screen-wave.
 *
 * Unlike a full config write, an override is a PARTIAL ScreeningRule — any subset
 * of the three known fields, merged over the saved config inside runScreenWave.
 * The same trust-boundary guarantees as validateDecisionConfig apply per PRESENT
 * field: stray keys are rejected, present fields are type-checked, and present
 * out-of-range numbers are CLAMPED to 0–100. An absent override (undefined/null)
 * is the no-op `{}` — run with the saved config — but a non-object override
 * (array, string, number) is a hard error: that's a malformed request, not
 * "no override".
 *
 * This closes the same catastrophe as the config boundary from the other side:
 * a raw `override` of { autoRejectEnabled:true, rejectBottomPercent:100,
 * maxMatchToReject:100 } would otherwise make the bottom-% the WHOLE cohort and
 * auto-reject every non-protected candidate — each firing an irreversible
 * rejection comm — straight past the modal's client-side clamps.
 *
 * On success returns ONLY the clamped known fields — never the raw body — so the
 * merge into runScreenWave's config can't carry a stray key or unclamped value.
 */
export function validateScreeningOverride(raw: unknown): ScreeningOverrideResult {
  if (raw === undefined || raw === null) return { ok: true, override: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "override must be a plain object." };
  }
  const obj = raw as Record<string, unknown>;
  const stray = Object.keys(obj).filter((k) => !(SCREENING_KEYS as readonly string[]).includes(k));
  if (stray.length > 0) {
    return { ok: false, error: `Unknown screening rule field(s): ${stray.join(", ")}.` };
  }
  const override: Partial<ScreeningRule> = {};
  if (obj.autoRejectEnabled !== undefined) {
    if (typeof obj.autoRejectEnabled !== "boolean") {
      return { ok: false, error: "autoRejectEnabled must be a boolean." };
    }
    override.autoRejectEnabled = obj.autoRejectEnabled;
  }
  for (const field of ["rejectBottomPercent", "maxMatchToReject", "holdoutPercent"] as const) {
    const v = obj[field];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return { ok: false, error: `${field} must be a finite number.` };
    }
    override[field] = clampPercent(v);
  }
  // A present familyFloors override REPLACES the saved map wholesale (partial-merge
  // semantics are per top-level field); validated + clamped exactly like a full write.
  if (obj.familyFloors !== undefined) {
    const floors = validateFamilyFloors(obj.familyFloors);
    if (!floors.ok) return { ok: false, error: floors.error };
    if (floors.value !== undefined) override.familyFloors = floors.value;
  }
  return { ok: true, override };
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

/**
 * DETERMINISTIC TIE-BREAK at the auto-reject cutoff — keep equal scores on the
 * SAME side of the boundary.
 *
 * `screenBottomCount` answers "how many of the bottom to reject", but that count
 * can land in the MIDDLE of a run of candidates sharing the IDENTICAL match
 * score. The cohort is sorted ascending by score with JS's STABLE sort, so a tie
 * straddling the cutoff would be split purely by pipeline ARRIVAL ORDER — one
 * candidate auto-rejected, an indistinguishable peer kept, with no merit-based or
 * documented reason (idea-50062f77). That is indefensible for an irreversible
 * automated rejection and makes the boundary non-reproducible from the scores.
 *
 * DECISION — never split a tied score across the cutoff, resolved IN THE
 * CANDIDATE'S FAVOUR: when a tie straddles the boundary, shrink the reject window
 * to the lower edge of that tied run so the whole tied group is KEPT. Rationale:
 *   • The boundary becomes deterministic and reproducible from the scores alone,
 *     independent of insertion order — the exact property the bug violated — so
 *     equal candidates always get the equal outcome.
 *   • It matches this module's fail-closed stance: when automation cannot justify
 *     singling out one of several identical candidates, it rejects NONE of them
 *     rather than an arbitrary subset. Expanding the window (reject the whole tied
 *     run) was rejected as over-eager — it would auto-reject candidates the
 *     configured bottom-% never selected, purely because they tied with someone
 *     below the cutoff.
 *   • Only the straddling tie is spared: candidates with a strictly LOWER score
 *     than the tied run are unaffected and still auto-rejected.
 *
 * Takes the ascending-sorted GENUINE scores (worst first — the caller's null-score
 * policy excludes unscored candidates before ranking, so no fabricated 0 reaches
 * this cutoff; see screen-wave.ts) and the raw bottomCount; returns the tie-safe
 * count to reject (0 ≤ result ≤ bottomCount). Pure and order-independent for equal
 * scores, so it is unit-tested directly. Mirrors the keep-side rationale in
 * screen-wave.ts.
 */
export function tieSafeBottomCount(sortedScoresAsc: readonly number[], bottomCount: number): number {
  if (bottomCount <= 0) return 0;
  if (bottomCount >= sortedScoresAsc.length) return sortedScoresAsc.length;
  // The cutoff sits between index b-1 (last rejected) and b (first kept). While
  // those two share a score the cutoff is splitting a tied run — walk it DOWN to
  // the run's lower edge so the entire tied group lands on the keep side.
  let b = bottomCount;
  while (b > 0 && sortedScoresAsc[b - 1] === sortedScoresAsc[b]) b -= 1;
  return b;
}
