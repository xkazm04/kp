// The role coach's PRIORITY VOCABULARY — the three weights a recruiter can hang on a
// pattern their candidate pool shows against a role, plus the sanitizer both ends of
// the wire share.
//
// Deliberately pure and import-free, like tenancy.ts and jobsCoachApply.ts: the CLIENT
// panel and the SERVER store must agree on exactly one definition of "a valid tag", and
// the panel cannot reach role-priorities-store.ts without dragging better-sqlite3 into
// the browser bundle (and out of reach of the type-stripping unit runner).

/** The three weights, ordered strongest → weakest.
 *
 *  The vocabulary is about WEIGHT ("how much should this count when the role is
 *  scored?"), not about requirement KIND. The role's requirements already carry a
 *  must_have / nice_to_have axis, and a second must/nice control beside it reads as
 *  the same field spelled twice. */
export const PRIORITY_LEVELS = ["critical", "important", "minor"] as const;
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];

/** Pattern id → level. A pattern with no entry is UNWEIGHTED — the recruiter has not
 *  judged it yet, which is a different state from having judged it `minor`. */
export type RolePriorityMap = Record<string, PriorityLevel>;

/** What a level is WORTH when the role's requirements are weighted. Flat small
 *  integers on purpose: "critical counts three times as much as minor" needs no
 *  calculator, and re-weighting is a visible diff. */
export const PRIORITY_WEIGHT: Record<PriorityLevel, number> = { critical: 3, important: 2, minor: 1 };

export function isPriorityLevel(v: unknown): v is PriorityLevel {
  return typeof v === "string" && (PRIORITY_LEVELS as readonly string[]).includes(v);
}

/** Pattern ids are minted by rolePatterns.ts from a kind plus a requirement value.
 *  Bounded here so a malformed body can't grow the stored row without limit. */
const ID_MAX = 160;
const ENTRIES_MAX = 200;

/** Keep only well-formed (id → level) pairs. A junk key or an unknown level is DROPPED
 *  rather than rejecting the whole save: the panel writes the FULL map on every tag
 *  change, so one bad entry must not cost the recruiter the rest of their weighting. */
export function sanitizePriorities(raw: unknown): RolePriorityMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: RolePriorityMap = {};
  let n = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= ENTRIES_MAX) break;
    const id = key.trim();
    if (!id || id.length > ID_MAX) continue;
    if (!isPriorityLevel(value)) continue;
    out[id] = value;
    n += 1;
  }
  return out;
}
