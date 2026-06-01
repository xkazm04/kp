// Single source of truth for the candidate archetype taxonomy: which archetypes
// exist, how they are labelled/badged in the UI, and — the compliance-critical
// part — the fairness gate that shields early-career candidates from AUTOMATED
// rejection.
//
// The protected set ("student", "career_switcher") used to be hand-copied into
// screen-wave.ts, group-eval-run.ts, comms-dispatch.ts, JobsTypes.ts and
// MatchTypes.ts, while archetype labels lived separately again in MatchTypes.ts
// and ProfileTypes.ts. A single rename in one copy could silently desync who is
// shielded — a real fairness/compliance hazard. Everything now derives from the
// constants here so the gate is auditable in one place.

/** Full archetype display labels (Match / Profile result panels). */
export const ARCHETYPE_LABEL: Record<string, string> = {
  bau: "Experienced",
  student: "Student / early-career",
  career_switcher: "Career-switcher",
};

/** Short badge labels (compact lists, e.g. recruiter candidate cards). */
export const ARCHETYPE_BADGE: Record<string, string> = {
  bau: "Experienced",
  student: "Student",
  career_switcher: "Switcher",
};

/** Early-career archetypes that are NEVER auto-rejected — the fairness
 *  guarantee DecisionRulesModal advertises. Mirror of the pipeline's
 *  automation.py early-career lever. */
export const FAIRNESS_PROTECTED_ARCHETYPES = ["student", "career_switcher"] as const;
const FAIRNESS_PROTECTED = new Set<string>(FAIRNESS_PROTECTED_ARCHETYPES);

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

/** Positive classification: true only for archetypes that ARE early-career.
 *  Unlike {@link isFairnessProtected} this treats unknown as NOT early — it
 *  drives display grouping and encouraging copy, not a safety gate, so it must
 *  not over-claim. */
export function isEarlyCareer(archetype: string | null | undefined): boolean {
  return FAIRNESS_PROTECTED.has(normalizeArchetype(archetype));
}
