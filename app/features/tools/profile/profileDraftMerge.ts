// The profile editor's form state as ONE plain object, plus the pure rule that
// decides what an AI draft may overwrite. No React here — profileDraftMerge.test.ts
// drives it directly.
//
// WHY a merge at all. `applyDraft` used to set every field from the draft, so a
// recruiter who had already typed a name, three skills and an availability line and
// THEN pasted notes into the AI panel lost all of it: no diff, no confirm, no undo.
// One directory over, the tab-level rebuild path guards exactly this case — it asks
// the store whether the profile diverged since it was built and raises
// ProfileTabRebuildWarnModal before re-hydrating. This is the same idiom, moved
// inside the editor where the divergence is in memory rather than in a column.
import type { SkillRow, EvidenceRow } from "@/app/features/shared/profileTypes";

/** Every input the editor owns, in one object. The hook derives its per-field
 *  setters from this so the whole form can be snapshotted, compared, backed up to
 *  sessionStorage and restored as a unit. */
export type ProfileFormState = {
  choice: string;
  isEnrolled: boolean;
  expectedGraduation: string;
  wantsDomainChange: boolean;
  hasSubstantialExperience: boolean;
  displayName: string;
  roleFamily: string;
  educationLevel: string;
  educationDetail: string;
  languages: string;
  location: string;
  availability: string;
  yearsExperience: string;
  seniority: string;
  aspirations: string;
  skills: SkillRow[];
  evidence: EvidenceRow[];
};

export type ProfileFormField = keyof ProfileFormState;

/** The neutral state, and — because the tests and the merge both enumerate its
 *  keys — the single declaration of WHICH fields exist. A field added to
 *  ProfileFormState but not here would silently never be merge-aware, so the
 *  contract test asserts the two agree. */
export function blankFormState(): ProfileFormState {
  return {
    choice: "auto",
    isEnrolled: false,
    expectedGraduation: "",
    wantsDomainChange: false,
    hasSubstantialExperience: false,
    displayName: "",
    roleFamily: "",
    educationLevel: "",
    educationDetail: "",
    languages: "",
    location: "",
    availability: "",
    yearsExperience: "",
    seniority: "",
    aspirations: "",
    skills: [],
    evidence: [],
  };
}

export const PROFILE_FORM_FIELDS = Object.keys(blankFormState()) as ProfileFormField[];

// `_id` is a client-only React key minted fresh by every hydrate() call, so two
// structurally identical row lists carry different ids. Comparing it would report
// EVERY re-hydration as a hand edit and make the confirm dialog permanent noise.
function comparable(value: unknown): string {
  if (Array.isArray(value)) {
    return JSON.stringify(value.map((row) => {
      if (row === null || typeof row !== "object") return row;
      const rest: Record<string, unknown> = { ...(row as Record<string, unknown>) };
      delete rest._id;
      return rest;
    }));
  }
  return JSON.stringify(value ?? null);
}

function same(a: unknown, b: unknown): boolean {
  return comparable(a) === comparable(b);
}

/**
 * Merge an AI draft into the live form, preserving hand edits.
 *
 * For each field: if the recruiter changed it since the form loaded (`current`
 * differs from `baseline`) AND the draft disagrees, the recruiter's value stays and
 * the field is listed in `kept` — that list is what the editor offers to override
 * with one click ("use the draft anyway"). Everything else takes the draft, which
 * is the whole point of drafting.
 *
 * A draft that leaves a field EMPTY is still a disagreement, so it can never blank
 * something the recruiter typed — the failure mode that stung hardest, because the
 * loss was invisible until after Save.
 *
 * Pure: none of the three inputs is mutated (row arrays are re-used by reference,
 * never written through).
 */
export function mergeDraft(
  current: ProfileFormState,
  baseline: ProfileFormState,
  draft: ProfileFormState
): { merged: ProfileFormState; kept: ProfileFormField[] } {
  const merged = { ...current };
  const kept: ProfileFormField[] = [];
  for (const field of PROFILE_FORM_FIELDS) {
    const edited = !same(current[field], baseline[field]);
    const differs = !same(current[field], draft[field]);
    if (edited && differs) {
      kept.push(field);
      continue;
    }
    // Assigning through the union of value types needs one cast; the key and the
    // value come from the SAME field, so it is sound by construction.
    (merged as Record<ProfileFormField, unknown>)[field] = draft[field];
  }
  return { merged, kept };
}
