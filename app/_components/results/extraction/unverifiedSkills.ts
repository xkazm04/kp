import { EXPLANATION_UNVERIFIED_SKILL_CODE } from "@/app/_lib/reasons-coverage";

/** The skills the engine coded as named in the explanation but absent from the CV
 *  (`explanation_unverified_skill`'s value), or null when there is no such finding. */
export function unverifiedExplanationSkills(
  findings: readonly { code: string; value?: string | null }[] | null | undefined
): string | null {
  const hit = (findings ?? []).find((f) => f.code === EXPLANATION_UNVERIFIED_SKILL_CODE);
  const skills = hit?.value?.trim();
  return skills ? skills : null;
}
