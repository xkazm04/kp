// Pure payload <-> form-state mapping for the candidate profile editor. Kept out
// of the (client) ProfileEditor component so it has ONE home and can be unit
// tested without a React/JSX runtime.
import type { SkillRow, EvidenceRow, ProfilePayload } from "@/app/features/shared/profileTypes";
import { DEFAULT_ROLE_FAMILY } from "@/app/_lib/role-families";

// Which archetype-conditional Basics fields a given archetype exposes. This is the
// SINGLE SOURCE OF TRUTH that both rendering (ProfileEditor decides whether to show
// the input) and submission (archetypeScopedProfileFields decides whether to persist
// its value) derive from. The two used to be coded independently — the field rendered
// for bau/career_switcher but build() persisted yearsExperience whenever the string was
// non-empty — so they drifted and hidden form state leaked into the saved payload.
export type ArchetypeFieldVisibility = { years: boolean; seniority: boolean };

export function archetypeFieldVisibility(choice: string): ArchetypeFieldVisibility {
  return {
    // Prior-field years are relevant to experienced hires and career-switchers; a
    // student / auto-detect intake never shows (nor saves) a years value.
    years: choice === "bau" || choice === "career_switcher",
    // Seniority is a BAU-only concept: students/switchers don't carry one.
    seniority: choice === "bau",
  };
}

// Build the archetype-scoped Basics fields (years / seniority) for the profile
// payload, enforcing the contract for idea-7ac9e45f: KEEP the form's useState across
// an archetype switch (so toggling back restores the recruiter's input), but SUBMIT
// STRICTLY BY VISIBILITY. A value the form hid for the selected archetype is therefore
// never persisted — switching career_switcher→student can't POST the years the UI
// hid, and switching bau→career_switcher can't POST the now-hidden seniority. We do
// NOT clear the underlying state on switch (the alternative half of the contract);
// keeping it makes the field non-destructive to toggle and keeps this logic pure.
export function archetypeScopedProfileFields(
  choice: string,
  yearsExperience: string,
  seniority: string,
): { yearsExperience?: number; seniority?: string } {
  const visible = archetypeFieldVisibility(choice);
  const fields: { yearsExperience?: number; seniority?: string } = {};
  // Drop a non-finite years (e.g. a non-numeric AI-draft value) rather than emitting NaN,
  // which JSON.stringify turns into null downstream — silently failing the years completeness
  // check with no signal. Only persist a real finite number.
  if (visible.years && yearsExperience.trim()) {
    const years = Number(yearsExperience);
    if (Number.isFinite(years)) fields.yearsExperience = years;
  }
  // Only persist seniority when one is actually selected — editing a profile that
  // never had a seniority must not invent one (it stays empty in hydrate()).
  if (visible.seniority && seniority) fields.seniority = seniority;
  return fields;
}

export const joinList = (xs: string[] | undefined) => (xs ?? []).join(", ");

// Monotonic client-only row-id generator for skill/evidence list keys. Stable per row
// for the lifetime of the editor, never persisted (see SkillRow._id). A plain counter,
// not crypto.randomUUID, so it has no secure-context / test-env dependency.
let _rowSeq = 0;
export const rowId = (): string => `row-${_rowSeq++}`;

// A blank intake row the editor falls back to when a profile has no skills /
// evidence, so the form always renders at least one (empty) input group.
export const SKILL_FALLBACK: SkillRow[] = [{ skill: "", level: "working", provenance: "self_declared", _id: "fallback-skill" }];
export const EVIDENCE_FALLBACK: EvidenceRow[] = [{ kind: "project", title: "", text: "", skills: "", link: "", _id: "fallback-evidence" }];

export type HydratedForm = ReturnType<typeof hydrate>;

// Map a persisted (normalized) payload back into editable form state.
//
// DECISION (idea-fa7d5360): the form does NOT pre-fill fields the candidate model
// treats as unknown. Create mode used to seed bachelor / "Czech, English" / junior
// so a blank intake could be saved fast — but build() submits whatever the form
// holds, so those unchosen defaults silently satisfied the education_known,
// has_languages and (for bau) has_seniority completeness checks before the recruiter
// touched anything. Completeness is a recruiter-facing signal that drives the
// "Add next" nudges; defaults nobody consciously picked inflated it (a blank profile
// read ~25% done) and misled both recruiters and new developers about why an empty
// profile scored above zero. So we start create-mode HONEST: completeness reflects
// real input, and the placeholders ("Czech, English") / the "not set" seniority
// option carry the hint instead of a value that gets persisted as declared.
//
// Hydration is therefore identical for create / edit / duplicate / applied-AI-draft:
// an absent field maps to an honest neutral (educationLevel "unknown" — a real
// level; languages / seniority empty). The lone fallback is roleFamily, which seeds
// the honest neutral DEFAULT_ROLE_FAMILY ("general_professional") — the matcher DOES
// score roleFamily, so the old software_engineering default silently biased non-tech
// profiles; it is not a completeness check, so it cannot inflate the score.
//
// Intake signals (isEnrolled / wantsDomainChange / …) are NOT stored on the
// payload — they only feed auto-detection — so on edit we pin `choice` to the
// stored archetype, which keeps re-routing stable without those booleans.
export function hydrate(payload: ProfilePayload | null) {
  return {
    choice: payload?.archetype || "auto",
    displayName: payload?.displayName ?? "",
    // roleFamily IS scored by the matcher (matching.py: family = 1.0 on a match else
    // 0.35/0.3), so a blank form must NOT default to "software_engineering" — that
    // biased every hand-built non-tech profile toward SWE roles and away from its true
    // family (candidate-profile-job-matching #2). Seed the honest neutral
    // DEFAULT_ROLE_FAMILY ("general_professional"), matching the analysis path's
    // "Never assume software" policy (role-families.ts / match-candidate.ts). It's a
    // real select option, not a completeness field, so it still can't inflate the score.
    roleFamily: payload?.roleFamily ?? DEFAULT_ROLE_FAMILY,
    // "unknown" is a real education level: a blank or absent value round-trips
    // honestly instead of being upgraded to a "bachelor" the candidate never claimed.
    educationLevel: payload?.educationLevel ?? "unknown",
    educationDetail: payload?.educationDetail ?? "",
    // free-text field with a "Czech, English" placeholder: stays empty when no
    // languages were given, rather than seeding (and later persisting) them.
    languages: payload?.languages?.length ? joinList(payload.languages) : "",
    location: payload?.location ?? "",
    availability: payload?.availability ?? "",
    yearsExperience: payload?.yearsExperience != null ? String(payload.yearsExperience) : "",
    // seniority is genuinely optional (students/early-career often lack it). Stays
    // empty when unset; build() only persists it when the recruiter picks one.
    seniority: payload?.seniority ?? "",
    aspirations: joinList(payload?.aspirations),
    skills: (payload?.skillClaims ?? [])
      .filter((s) => (s.skill ?? "").trim())
      .map((s) => ({ skill: s.skill ?? "", level: s.level ?? "working", provenance: s.provenance ?? "self_declared", _id: rowId() })) as SkillRow[],
    evidence: (payload?.evidence ?? []).map((e) => ({
      kind: e.kind ?? "project",
      title: e.title ?? "",
      text: e.text ?? "",
      skills: joinList(e.skills),
      link: e.link ?? "",
      _id: rowId(),
    })) as EvidenceRow[],
  };
}
