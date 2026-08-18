"use client";

// Copy for the board-axis editing model, in one place.
//
// Two surfaces now edit the same axis under the same rules (see
// pipelineAxisDraft.ts): Settings → Hiring and the first-run wizard's Pipeline
// step. The RULES were already shared; these two hooks share the WORDS, so the
// wizard cannot tell an operator something different about why a shape is
// refused than the composer does two clicks later. The catalog namespace stays
// `hiringPlan` — the composer owns that vocabulary, and a second copy under
// `setup` would be four more locales of the same eight sentences.
import { useTranslations } from "next-intl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import type { AxisProblem } from "./pipelineAxisDraft";

/**
 * What a column is CALLED on screen.
 *
 * A workspace's own label wins; a column it has never renamed (`label === id`)
 * resolves through the shared `enums.stage.*` catalog, so the five shipped
 * columns stay localized in four locales while a hand-authored one shows the
 * recruiter's own words untranslated — which is correct, nobody else wrote them.
 * PipelineBoard.tsx applies the same rule to the board header; this is the copy
 * of it any axis EDITOR needs, so a rename field never offers to overwrite a
 * localized name with itself.
 */
export function useStageDisplayLabel(): (stage: Pick<StageDef, "id" | "label">) => string {
  const enumLabel = useEnumLabel();
  return (stage) => (stage.label === stage.id ? enumLabel("stage", stage.id) : stage.label);
}

/** A stage role's display name ("Arrives here", "Screening"), falling back to the
 *  raw slug so an axis carrying a role the catalog hasn't named still renders. */
export function usePipelineStageRoleLabel(): (role: string) => string {
  const tRole = useTranslations("hiringPlan.roles");
  return (role: string): string => {
    const key = role as Parameters<typeof tRole>[0];
    return tRole.has(key) ? tRole(key) : role;
  };
}

/** Why this draft cannot be saved, as a sentence. The rule lives in
 *  `axisProblems`; this is only its wording. */
export function usePipelineAxisProblemText(): (problem: AxisProblem) => string {
  const t = useTranslations("hiringPlan.steps");
  const roleLabel = usePipelineStageRoleLabel();
  return (p: AxisProblem): string => {
    switch (p.code) {
      case "tooFew":
        return t("problemTooFew");
      case "tooMany":
        return t("problemTooMany", { max: p.max });
      case "emptyLabel":
        return t("problemEmptyLabel");
      case "duplicateLabel":
        return t("problemDuplicateLabel", { label: p.label });
      case "missingRole":
        return t("problemMissingRole", { role: roleLabel(p.role) });
      case "duplicateRole":
        return t("problemDuplicateRole", { role: roleLabel(p.role) });
      case "entryNotFirst":
        return t("problemEntryNotFirst");
      default:
        return t("problemTerminalNotLast");
    }
  };
}
