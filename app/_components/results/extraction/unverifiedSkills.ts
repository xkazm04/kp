// The code is declared in app/_lib/reasons-coverage.ts (and pipeline.py); it is repeated here
// because importing it put that whole module on app/page.tsx's graph for one string.
// unverifiedSkills.test.ts pins the two equal.
const EXPLANATION_UNVERIFIED_SKILL_CODE = "explanation_unverified_skill";

/** The skills the engine coded as named in the explanation but absent from the CV
 *  (`explanation_unverified_skill`'s value), or null when there is no such finding. */
export function unverifiedExplanationSkills(
  findings: readonly { code: string; value?: string | null }[] | null | undefined
): string | null {
  const hit = (findings ?? []).find((f) => f.code === EXPLANATION_UNVERIFIED_SKILL_CODE);
  const skills = hit?.value?.trim();
  return skills ? skills : null;
}
