// Turns a completeness "still-missing" item (the human labels profile_cli emits in
// `missing`) into the editor field a recruiter fills to satisfy it — so the result
// panel's "Add next" list becomes clickable and jumps to the right input instead of
// being inert text.
//
// The label -> check id map is derived from THE registry both engines read
// (archetypes.json: commonChecklist + each archetype's checklist), so a label or
// weight edit there can never desync the mapping. profile_cli emits the raw registry
// labels, so an exact-label lookup is the honest join short of Python emitting the
// check ids (out of this context's scope).

import registry from "@/pipeline/jobfit/archetypes.json";

export type ProfileFieldKey =
  | "seniority"
  | "years"
  | "aspirations"
  | "educationDetail"
  | "educationLevel"
  | "languages"
  | "skills"
  | "evidence";

// The DOM id ProfileEditor stamps on each targetable field's wrapper — the shared
// scroll/focus anchor both the editor (stamps) and the result panel (targets) key off.
export const FIELD_DOM_ID: Record<ProfileFieldKey, string> = {
  seniority: "pf-field-seniority",
  years: "pf-field-years",
  aspirations: "pf-field-aspirations",
  educationDetail: "pf-field-education-detail",
  educationLevel: "pf-field-education-level",
  languages: "pf-field-languages",
  skills: "pf-field-skills",
  evidence: "pf-field-evidence",
};

// Which editor field satisfies each checklist predicate (registry `check` id).
const CHECK_TO_FIELD: Record<string, ProfileFieldKey> = {
  has_seniority: "seniority",
  has_years: "years",
  has_job: "evidence",
  has_aspirations: "aspirations",
  has_education_detail: "educationDetail",
  has_project_or_thesis: "evidence",
  has_activity: "evidence",
  education_known: "educationLevel",
  has_languages: "languages",
  min_3_skills: "skills",
};

type ChecklistItem = { check: string; label: string };

function buildLabelToCheck(): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (items: ChecklistItem[]) => {
    for (const it of items) out[it.label] = it.check;
  };
  const reg = registry as { commonChecklist?: ChecklistItem[]; archetypes?: { checklist?: ChecklistItem[] }[] };
  add(reg.commonChecklist ?? []);
  for (const a of reg.archetypes ?? []) add(a.checklist ?? []);
  return out;
}

const LABEL_TO_CHECK = buildLabelToCheck();

/** The editor field that resolves a given missing-completeness label, or null when
 *  the label isn't one we can route to a single input (leave it as plain text).
 *  LEGACY join — exact English label match; superseded by fieldTargetForCheck for
 *  results that carry the stable check id, kept for pre-missingGaps results. */
export function fieldTargetForMissing(missingLabel: string): ProfileFieldKey | null {
  const check = LABEL_TO_CHECK[missingLabel.trim()];
  return check ? CHECK_TO_FIELD[check] ?? null : null;
}

/** The editor field that resolves a gap identified by its stable registry `check`
 *  id — the id-join that replaces the brittle exact-English-string match, so every
 *  gap the registry emits routes to its input (no locale/wording dead-text). Null
 *  only for a genuinely unmapped check id. */
export function fieldTargetForCheck(check: string): ProfileFieldKey | null {
  return CHECK_TO_FIELD[check] ?? null;
}
