// Rebuild a profile from a NEWER analysis of its CV as a field-level merge that keeps
// the recruiter's edits. Pure; profileRebuildMerge.test.ts drives it.
//
// CURRENT (the profile, with edits) vs SOURCE (the analysis it was built from) vs NEWER.
// Per field: untouched -> newer CV; edited but unchanged by the newer CV -> kept
// ("preserved"); edited AND changed differently -> kept and CONTESTED, the only case
// worth a question. No SOURCE (analysis deleted): nothing can be attributed, so every
// field that differs from NEWER is contested and CURRENT kept. Not mergeDraft's rule
// (its `kept` also lists edits the draft merely did not echo); only its comparison.
import type { ProfilePayload } from "@/app/features/shared/profileTypes";
import { mergeDraft, type ProfileFormField, type ProfileFormState } from "./profileDraftMerge";
import { formStateFrom } from "./useProfileEditorFields";

export type RebuildMode = "three-way" | "unknown-baseline";

export type RebuildPlan = {
  mode: RebuildMode;
  /** What Undo restores. */
  current: ProfileFormState;
  /** What "use the new CV anyway" takes. */
  newer: ProfileFormState;
  merged: ProfileFormState;
  /** Edited by hand AND changed by the newer CV: kept, and asked about. */
  contested: ProfileFormField[];
  /** Edited by hand, not changed by the newer CV: kept without a question. */
  preserved: ProfileFormField[];
  needsConfirm: boolean;
};

/** useProfileEditorFields' pending change: undo point, alternative, refused fields. */
export type EditorPending = {
  before: ProfileFormState;
  draft: ProfileFormState;
  kept: ProfileFormField[];
  origin?: "draft" | "rebuild";
};

export type RebuildSeed = { state: ProfileFormState; pending: EditorPending };

export type RebuildAction = "merge" | "keep" | "replace";
export type RebuildDialogModel = {
  contestedFields: ProfileFormField[];
  actions: RebuildAction[];
  default: RebuildAction;
};

// Fields where `a` and `b` differ, by mergeDraft's own comparison (draft = baseline
// makes `kept` exactly "a differs from b"), so re-minted row `_id`s never count.
function differingFields(a: ProfileFormState, b: ProfileFormState): Set<ProfileFormField> {
  return new Set(mergeDraft(a, b, b).kept);
}

export function planRebuild({
  current,
  source,
  newer,
}: {
  current: ProfileFormState;
  source: ProfileFormState | null;
  newer: ProfileFormState;
}): RebuildPlan {
  const differsFromNewer = differingFields(current, newer);
  if (!source) {
    const contested = [...differsFromNewer];
    return { mode: "unknown-baseline", current, newer, merged: { ...current }, contested, preserved: [], needsConfirm: contested.length > 0 };
  }
  const edited = differingFields(current, source);
  const changed = differingFields(newer, source);
  const merged = { ...current };
  const contested: ProfileFormField[] = [];
  const preserved: ProfileFormField[] = [];
  // Iterate in form order so the dialog lists fields the way the editor lays them out.
  for (const field of Object.keys(current) as ProfileFormField[]) {
    if (!edited.has(field)) {
      (merged as Record<ProfileFormField, unknown>)[field] = newer[field];
    } else if (!changed.has(field)) {
      preserved.push(field);
    } else if (differsFromNewer.has(field)) {
      contested.push(field);
    }
    // edited AND changed to the SAME value: the two sides agree, keep it quietly.
  }
  return { mode: "three-way", current, newer, merged, contested, preserved, needsConfirm: contested.length > 0 };
}

/** Plan from stored payloads, through the editor's one payload->form mapping. */
export function planRebuildFromPayloads(
  current: ProfilePayload | null,
  source: ProfilePayload | null,
  newer: ProfilePayload | null
): RebuildPlan {
  return planRebuild({
    current: formStateFrom(current),
    source: source ? formStateFrom(source) : null,
    newer: formStateFrom(newer),
  });
}

/** The editor opens ON the merge with the rebuild pending (banner: use anyway / Undo). */
export function rebuildEditorState(plan: RebuildPlan): RebuildSeed {
  return {
    state: plan.merged,
    pending: { before: plan.current, draft: plan.newer, kept: plan.contested, origin: "rebuild" },
  };
}

/** What the warn dialog shows — null when nothing is contested (no ceremony). */
export function rebuildDialogModel(plan: RebuildPlan): RebuildDialogModel | null {
  if (!plan.needsConfirm) return null;
  return { contestedFields: [...plan.contested], actions: ["merge", "keep", "replace"], default: "merge" };
}

/** Each field's editor label, relative to the `profile` catalog namespace. */
export const REBUILD_FIELD_LABEL_KEY = {
  choice: "editor.candidateArchetype",
  isEnrolled: "editor.enrolled",
  expectedGraduation: "editor.expectedGrad",
  wantsDomainChange: "editor.wantsChange",
  hasSubstantialExperience: "editor.hasPrior",
  displayName: "editor.name",
  roleFamily: "editor.targetField",
  educationLevel: "editor.eduLevel",
  educationDetail: "editor.studyProgramme",
  languages: "editor.languages",
  location: "editor.location",
  availability: "editor.availability",
  yearsExperience: "editor.yearsExperience",
  seniority: "editor.seniority",
  aspirations: "editor.aspirations",
  skills: "evidence.skillsTitle",
  evidence: "evidence.evidenceTitle",
} as const satisfies Record<ProfileFormField, string>;
