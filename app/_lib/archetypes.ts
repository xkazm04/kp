// The candidate archetype taxonomy for the TS app — DERIVED FROM THE SHARED
// REGISTRY (pipeline/jobfit/archetypes.json), the exact same file the Python
// pipeline reads via registry.py. Because both sides read one file, the
// TS<->Python desync this module used to guard against by hand (labels copied
// into MatchTypes/ProfileTypes, the protected set copied into screen-wave /
// group-eval-run / comms-dispatch) is now structurally impossible: a rename or a
// new archetype lands in one place and both languages see it.
//
// The compliance-critical part is the FAIRNESS gate: which archetypes are
// shielded from AUTOMATED rejection. That flag (`fairnessProtected`) lives in the
// registry; the gate below still fails closed for anything it cannot classify.

import archetypeRegistry from "@/pipeline/jobfit/archetypes.json";

type ArchetypeDef = {
  id: string;
  label: string;
  badge: string;
  fairnessProtected: boolean;
  scoringModel: string;
};

const ARCHETYPES = archetypeRegistry.archetypes as ArchetypeDef[];

/** Full archetype display labels (Match / Profile result panels). */
export const ARCHETYPE_LABEL: Record<string, string> = Object.fromEntries(
  ARCHETYPES.map((a) => [a.id, a.label])
);

/** Short badge labels (compact lists, e.g. recruiter candidate cards). */
export const ARCHETYPE_BADGE: Record<string, string> = Object.fromEntries(
  ARCHETYPES.map((a) => [a.id, a.badge])
);

/** Early-career archetypes that are NEVER auto-rejected — the fairness
 *  guarantee DecisionRulesModal advertises. Mirror of the pipeline's
 *  automation.py early-career lever; sourced from the registry's
 *  `fairnessProtected` flag. */
export const FAIRNESS_PROTECTED_ARCHETYPES: readonly string[] = ARCHETYPES.filter(
  (a) => a.fairnessProtected
).map((a) => a.id);
const FAIRNESS_PROTECTED = new Set<string>(FAIRNESS_PROTECTED_ARCHETYPES);

// Archetypes scored on the potential/readiness model (vs years-of-experience).
const EARLY_CAREER = new Set<string>(
  ARCHETYPES.filter((a) => a.scoringModel === "early_career").map((a) => a.id)
);

/** Canonical form of an archetype string: trimmed + lower-cased, so "Student",
 *  " student " and "STUDENT" all resolve to the same key. */
export function normalizeArchetype(archetype: string | null | undefined): string {
  return (archetype ?? "").trim().toLowerCase();
}

/** Whether the archetype is one we recognize at all. Backs the fail-closed
 *  fairness gate: an unknown / renamed archetype must NOT be treated as fair
 *  game for auto-rejection. */
export function isKnownArchetype(archetype: string | null | undefined): boolean {
  return normalizeArchetype(archetype) in ARCHETYPE_LABEL;
}

/** The fairness gate. True when a candidate must be shielded from AUTOMATED
 *  rejection: either an explicit early-career archetype, OR an unknown one
 *  (fail closed — we never auto-reject a class we cannot classify). Use this at
 *  the auto-reject decision point. */
export function isFairnessProtected(archetype: string | null | undefined): boolean {
  return !isKnownArchetype(archetype) || FAIRNESS_PROTECTED.has(normalizeArchetype(archetype));
}

/** Positive classification: true only for archetypes scored on the early-career
 *  (potential) model. Unlike {@link isFairnessProtected} this treats unknown as
 *  NOT early — it drives display grouping and encouraging copy, not a safety
 *  gate, so it must not over-claim. */
export function isEarlyCareer(archetype: string | null | undefined): boolean {
  return EARLY_CAREER.has(normalizeArchetype(archetype));
}
