// The completeness-driven intake follow-up: after a CV analysis, the pipeline
// reports the archetype checklist's unmet items as structured {check, label}
// gaps (profile.completeness_gaps, riding transiently on the v2Profile dump).
// This module is the TS half of that loop — the per-check input the UI renders
// and the pure merge that folds the candidate's answers back into the profile
// payload before it is saved through /api/profile (profile_cli re-normalizes,
// re-resolves provenance, and re-scores completeness server-side, so nothing
// here needs to re-implement the checklist).
//
// Registry-free and side-effect-free so it is directly unit-testable; see
// completeness-followup.test.ts.

// The shared comma/semicolon list splitter (pure, dependency-free). These are
// single-line answers, so no newline splitting — the default behavior here.
import { splitList } from "./split-list.ts";
// Type-only (erased at runtime): the shape of the injected translator. See GapTranslator.
import type { useTranslations } from "next-intl";

export type CompletenessGap = { check: string; label: string };

export type GapFieldSpec = {
  /** Key under the `apply.gapFields` catalog namespace holding this field's
   *  `.prompt` and `.placeholder`. The copy itself is NOT stored here: these
   *  questions are now asked of the CANDIDATE (post-apply follow-up) as well as
   *  the recruiter, so they must render in the candidate's language. */
  key: string;
  /** Render a textarea (free story) instead of a single-line input. */
  multiline?: boolean;
};

/**
 * One targeted input per checklist predicate (pipeline/jobfit/profile.py
 * CHECKS). A check id with no entry here simply renders no field — fail quiet,
 * because an unknown/new check is a registry addition the form can't collect
 * for yet, and the profile stays saveable either way.
 */
export const GAP_FIELDS: Record<string, GapFieldSpec> = {
  has_project_or_thesis: { key: "hasProjectOrThesis", multiline: true },
  has_aspirations: { key: "hasAspirations" },
  has_education_detail: { key: "hasEducationDetail" },
  has_activity: { key: "hasActivity", multiline: true },
  education_known: { key: "educationKnown" },
  has_languages: { key: "hasLanguages" },
  min_3_skills: { key: "min3Skills" },
  has_years: { key: "hasYears" },
  has_job: { key: "hasJob", multiline: true },
};

/** The `apply.gapFields`-namespace translator the caller threads in, exactly like
 *  buildApplyScript's ApplyTranslator — so this module keeps NO runtime next-intl
 *  dependency (the import below is type-only and erased) and stays directly
 *  unit-testable. Server-resolved via getTranslations("apply.gapFields"), or the
 *  client hook of the same name; both satisfy this type. */
export type GapTranslator = ReturnType<typeof useTranslations<"apply.gapFields">>;

/** Localized copy for one gap field, or null for a check this form can't collect
 *  for (an unknown/new registry id — see GAP_FIELDS). */
export function gapFieldCopy(
  check: string,
  t: GapTranslator
): { prompt: string; placeholder: string; multiline: boolean } | null {
  const spec = GAP_FIELDS[check];
  if (!spec) return null;
  // The key is composed from the GAP_FIELDS registry (never from user input), so
  // it is a valid catalog path by construction — next-intl's key type can't see
  // that through the template literal.
  const key = (leaf: string) => `${spec.key}.${leaf}` as Parameters<GapTranslator>[0];
  return {
    prompt: t(key("prompt")),
    placeholder: t(key("placeholder")),
    multiline: Boolean(spec.multiline),
  };
}

/**
 * Fold the answered gap fields into a copy of the analyzed v2Profile payload.
 * Untouched/blank answers change nothing; the transient `completenessGaps` key
 * is always stripped so the saved profile never carries the gap list. Free-text
 * stories become TYPED evidence (so the Python normalizer prices their
 * provenance honestly); list answers extend rather than replace what the CV
 * already yielded; skills enter as self_declared claims — the followup is the
 * candidate's own words, not verified evidence.
 */
export function mergeGapAnswers(
  v2Profile: Record<string, unknown>,
  answers: Record<string, string>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...v2Profile };
  delete out.completenessGaps;
  const evidence = [...((out.evidence as Record<string, unknown>[] | undefined) ?? [])];
  const answer = (check: string): string => (answers[check] ?? "").trim();

  const project = answer("has_project_or_thesis");
  if (project) {
    evidence.push({ kind: "project", title: "Project or thesis (intake follow-up)", text: project, skills: [] });
  }
  const activity = answer("has_activity");
  if (activity) {
    evidence.push({ kind: "extracurricular", title: "Activity (intake follow-up)", text: activity, skills: [] });
  }
  const jobStory = answer("has_job");
  if (jobStory) {
    evidence.push({ kind: "job", title: "Work experience (intake follow-up)", text: jobStory, skills: [] });
  }
  out.evidence = evidence;

  const aspirations = answer("has_aspirations");
  if (aspirations) out.aspirations = [...((out.aspirations as string[] | undefined) ?? []), aspirations];
  const educationDetail = answer("has_education_detail");
  if (educationDetail) out.educationDetail = educationDetail;
  const educationLevel = answer("education_known");
  if (educationLevel) out.educationLevel = educationLevel.toLowerCase();
  const languages = splitList(answer("has_languages"));
  if (languages.length) {
    const existing = (out.languages as string[] | undefined) ?? [];
    const seen = new Set(existing.map((l) => l.toLowerCase()));
    out.languages = [...existing, ...languages.filter((l) => !seen.has(l.toLowerCase()))];
  }
  const skills = splitList(answer("min_3_skills"));
  if (skills.length) {
    const claims = [...((out.skillClaims as { skill?: string; provenance?: string }[] | undefined) ?? [])];
    const seen = new Set(claims.map((c) => (c.skill ?? "").toLowerCase()));
    for (const skill of skills) {
      if (seen.has(skill.toLowerCase())) continue;
      seen.add(skill.toLowerCase());
      claims.push({ skill, provenance: "self_declared" });
    }
    out.skillClaims = claims;
  }
  const years = Number(answer("has_years"));
  if (answer("has_years") !== "" && Number.isFinite(years) && years >= 0) out.yearsExperience = years;

  return out;
}
