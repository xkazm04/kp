// Rebuild a profile from a NEWER analysis of its CV as a field-level merge that keeps
// the recruiter's edits. Pure — profileRebuildMerge.test.ts drives it directly.
//
// Three states meet here: the profile as it stands (CURRENT — the recruiter's edits),
// the analysis it was built from (SOURCE — the baseline that tells an edit from what the
// CV said), and the newer analysis (NEWER — the machine update). Per field:
//   - untouched since the build  -> take the newer CV;
//   - edited, newer CV unchanged -> keep the edit silently ("preserved");
//   - edited AND newer CV changed it to something else -> keep the edit, and list the
//     field as CONTESTED — the only case worth a question.
// "Present the intersection, not the diff": the dialog appears only when something is
// contested, and names exactly those fields. When the baseline is gone (the source
// analysis was deleted) nothing can be attributed, so every field that differs from the
// newer CV is contested and the current value kept — never a silent overwrite.
//
// This is NOT mergeDraft's rule: mergeDraft's `kept` lists every edited field the draft
// merely failed to echo, which here would turn "the new CV didn't mention it" into a
// conflict. The comparison itself (row `_id`s stripped) is mergeDraft's, reused below.
import type { ProfilePayload } from "@/app/features/shared/profileTypes";
import { mergeDraft, type ProfileFormField, type ProfileFormState } from "./profileDraftMerge";
import { formStateFrom } from "./useProfileEditorFields";

export type RebuildMode = "three-way" | "unknown-baseline";

export type RebuildPlan = {
  mode: RebuildMode;
  /** The form as it stood before the rebuild — what Undo restores. */
  current: ProfileFormState;
  /** The newer analysis as a form — what "use the new CV anyway" takes. */
  newer: ProfileFormState;
  merged: ProfileFormState;
  /** Edited by hand AND changed by the newer CV: kept, and asked about. */
  contested: ProfileFormField[];
  /** Edited by hand, not changed by the newer CV: kept without a question. */
  preserved: ProfileFormField[];
  needsConfirm: boolean;
};

/** The editor's pending-change record (useProfileEditorFields) — the undo point, the
 *  whole alternative, and the fields that alternative was refused. */
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

// The fields where `a` and `b` differ, by mergeDraft's own comparison: with the draft
// equal to the baseline, `kept` is exactly "current differs from baseline". One rule
// for what counts as a change (row `_id`s re-minted by hydrate are not), not two.
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

/** The editor opens ON the merge, with the rebuild as a pending change: the banner
 *  offers "use the new CV anyway" for exactly the contested fields, and Undo restores
 *  the pre-rebuild form. */
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

/** Each form field's label, relative to the `profile` catalog namespace — the same words
 *  the editor shows beside the input, so the dialog names a field the way the form does. */
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
