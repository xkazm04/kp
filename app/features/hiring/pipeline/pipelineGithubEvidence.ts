// The pipeline drawer's frozen GitHub evidence card (PipelineGithubEvidenceCard.tsx),
// the part node:test can hold.
//
// The repo-signal review's `unverifiedClaims` are skills it did not SEE in public
// repo signals. Public work can confirm a skill but never rule one out (registry:
// recruiting/public-work-evidence-bounding, corroborate-a-claim-never-replace-it),
// so the card labels that list "Not seen in public repos" in a neutral token. It
// used to sit under an amber "Unverified claims:", which read absence of public
// evidence as the candidate's claim being false. The analysis panel's skill ledger
// (app/_lib/github/skill-ledger.ts) calls the same bucket "Not reached".

export const GITHUB_NOT_SEEN_KEY = "githubNotSeen" as const;
export const GITHUB_NOT_SEEN_TITLE_KEY = "githubNotSeenTitle" as const;
export const GITHUB_NOT_SEEN_CLASS = "font-semibold text-steel";

/**
 * The review's not-seen skills, trimmed and de-duplicated case-insensitively, minus
 * any skill the same review evidenced (one skill never sits in both lists).
 */
export function notSeenInPublicRepos(summary: {
  confirmedSkills: readonly string[];
  unverifiedClaims: readonly string[];
}): string[] {
  const seen = new Set(summary.confirmedSkills.map((s) => s.trim().toLowerCase()));
  const out: string[] = [];
  for (const raw of summary.unverifiedClaims) {
    const label = raw.trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}
