// Three funnel shapes for the wizard's Pipeline step, DERIVED from the axis the
// workspace actually has — never a second hardcoded board.
//
// Why derived: the shipped axis (pipeline-stages.ts DEFAULT_STAGE_AXIS) owns the
// stage ids that every stored row, event and analytics bucket already uses, and
// its labels are data an operator may already have renamed. A preset built from
// invented ids would mint keys nothing else knows, and one built from invented
// labels would show English column names next to the operator's own. So each
// preset is an EDIT of the loaded axis: keep a subset, or add one step. Only the
// added step needs a name, and the caller passes it in localized.
//
// Ids are minted once at add time and never move (mintStageId) — the same
// contract the Settings composer works under.
import { AXIS_MAX_STAGES, mintStageId, type AxisDraft, type DraftStage } from "@/app/features/shared/pipelineAxisDraft";

export type SetupPipelinePresetKey = "recommended" | "lean" | "technical";

/** In offer order: the shape most workspaces keep, the short one, the long one. */
export const SETUP_PIPELINE_PRESETS: readonly SetupPipelinePresetKey[] = ["recommended", "lean", "technical"];

/** Seed for the work-sample column's stored id. Locale-independent on purpose. */
const WORK_SAMPLE_ID_SEED = "Work sample";

/**
 * A preset applied to `base` (the loaded axis, unedited).
 *
 * - `recommended` — exactly what the workspace has: every column as shipped.
 * - `lean` — the entry column, the first interview column, and the terminal one.
 *   Three steps for a team that screens and decides in one conversation.
 * - `technical` — the full axis plus one work-sample column, placed before the
 *   offer (or, failing that, before the terminal step): the shape a dev-hiring
 *   funnel needs so a case sits between talking and offering.
 *
 * Both edits are safe by construction — entry stays first, terminal stays last,
 * neither role is duplicated, and the added column is skipped when the axis has no
 * room for it or already carries it — so a preset can never hand the operator an
 * axis the editor (or the server) would refuse.
 */
export function applyPipelinePreset(key: SetupPipelinePresetKey, base: AxisDraft, workSampleLabel: string): AxisDraft {
  if (key === "recommended") return base;
  if (key === "lean") {
    const firstInterview = base.stages.find((s) => s.role === "interview");
    const keep = new Set<string>();
    for (const s of base.stages) if (s.role === "entry" || s.role === "terminal") keep.add(s.id);
    if (firstInterview) keep.add(firstInterview.id);
    return { ...base, stages: base.stages.filter((s) => keep.has(s.id)) };
  }
  // The wizard also opens over an EXISTING workspace (Settings → "Preview
  // onboarding", `?onboarding=1`), so `base` is not always the shipped five. Two
  // such boards have no room for the added column, and adding it anyway produces a
  // draft `axisProblems` refuses — which is what `stepSatisfied("pipeline")` reads,
  // so the one-click preset would leave Continue dead:
  //   • a board already at the cap → `tooMany`;
  //   • a board that already has a step by this name → `duplicateLabel` (two
  //     columns a recruiter cannot tell apart; the editor is stricter than the wire
  //     here on purpose — see pipelineAxisDraft.axisProblems).
  // In both cases the board already IS the shape this preset describes, so hand it
  // back untouched rather than an edit that can only be refused.
  const wanted = workSampleLabel.trim().toLowerCase();
  if (base.stages.length >= AXIS_MAX_STAGES) return base;
  if (base.stages.some((s) => s.label.trim().toLowerCase() === wanted)) return base;
  const taken = [...base.stages.map((s) => s.id), ...base.retired.map((s) => s.id)];
  // The id is minted from a FIXED ASCII seed, not from the localized label: it is
  // a storage key (pipeline_entries.stage, the ATS field map), it must not differ
  // per locale, and `activePipelinePreset` below has to be able to re-derive it
  // after the operator switches the app language mid-wizard.
  const step: DraftStage = { id: mintStageId(WORK_SAMPLE_ID_SEED, taken), label: workSampleLabel, role: "custom", saved: false };
  const offerIdx = base.stages.findIndex((s) => s.role === "offer");
  const terminalIdx = base.stages.findIndex((s) => s.role === "terminal");
  const at = offerIdx >= 0 ? offerIdx : terminalIdx >= 0 ? terminalIdx : base.stages.length;
  const stages = [...base.stages];
  stages.splice(at, 0, step);
  return { ...base, stages };
}

/**
 * Which preset this draft still IS, or null once it has been hand-edited past all
 * three.
 *
 * Compared on ids and roles, not labels: renaming a column is the customization
 * the step invites, and it must not silently deselect the shape the operator
 * picked. Order counts — a reordered funnel is a different funnel.
 */
export function activePipelinePreset(
  draft: AxisDraft,
  base: AxisDraft,
  workSampleLabel: string
): SetupPipelinePresetKey | null {
  const signature = (d: AxisDraft): string => d.stages.map((s) => `${s.id}:${s.role}`).join(">");
  const mine = signature(draft);
  return SETUP_PIPELINE_PRESETS.find((key) => signature(applyPipelinePreset(key, base, workSampleLabel)) === mine) ?? null;
}
