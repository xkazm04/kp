import type { GithubRepo } from "./client";
import { complexityAssessment } from "./heuristics";
// The taxonomy and its whole-token matcher live in skill-ledger.ts, an import-light
// leaf the client panel can load without pulling heuristics.ts (and its repo-activity
// dependency) onto the workspace page's graph. canonicalSkill is re-exported so a
// server-side caller keeps reaching the JD comparison's vocabulary through here.
import { SKILL_ALIASES, aliasMatches, tokenizeForSkills } from "./skill-ledger";
export { canonicalSkill } from "./skill-ledger";

// The labels a repository carries that the comparison reads. One definition, used
// for both the flattened haystack and the per-repo attribution, so the two can never
// disagree about what a repo "said".
function repoLabels(repo: GithubRepo): string[] {
  return [repo.name, repo.description ?? "", repo.language ?? "", ...(repo.topics ?? [])];
}

function dedupeNames(names: string[]): string[] {
  return [...new Set(names)];
}

export function buildJobFitSignals(
  jobDescription: string,
  repos: GithubRepo[],
  languages: Array<{ name: string; percent: number }>,
  // FINDING #2: false when some /languages sub-fetches were throttled/errored this
  // run, so the language evidence is a partial read. A gap ("JD names it AND the
  // evidence doesn't show it") is only trustworthy when this is true.
  languageCoverageComplete: boolean
) {
  // Did we actually have a JD to compare against? Empty matchingSkills means something
  // completely different depending on this: with no JD we never ran a comparison, while
  // with a JD it means a genuine zero-overlap. Surfaced so the UI can disambiguate the two.
  const jobDescriptionProvided = jobDescription.trim().length > 0;
  // Word-boundary token matching, NOT substring: a substring test credits "ai"
  // inside "available", "ts" inside dozens of words, "ci" inside "official". We
  // tokenize into a set and only credit a skill when an alias's word(s) appear as
  // real tokens. Keeps +, #, . so "c++"/"c#"/"node.js" survive; strips sentence
  // punctuation so "AI." still matches "ai".
  const haystackTokens = tokenizeForSkills(
    [
      ...repos.flatMap((repo) => repoLabels(repo)),
      ...languages.map((language) => language.name)
    ].join(" ")
  );
  // Per-repo token sets, kept beside the flattened haystack: the haystack decides
  // WHETHER a skill matched (unchanged semantics), these say WHERE. Flattening used
  // to throw the attribution away, so a "match" was an unattributed claim a
  // recruiter could not open. A skill matched only through the aggregate language
  // mix names no repo rather than guessing one.
  const repoTokens = repos.map((repo) => ({ name: repo.name, tokens: tokenizeForSkills(repoLabels(repo).join(" ")) }));
  const jobTokens = tokenizeForSkills(jobDescription);
  const matchingSkills: string[] = [];
  const potentialGaps: string[] = [];
  const skillEvidence: Record<string, string[]> = {};

  for (const [skill, aliases] of Object.entries(SKILL_ALIASES)) {
    const jobMentions = aliases.some((alias) => aliasMatches(alias, jobTokens));
    const githubMentions = aliases.some((alias) => aliasMatches(alias, haystackTokens));
    if (jobMentions && githubMentions) {
      matchingSkills.push(skill);
      skillEvidence[skill] = dedupeNames(
        repoTokens.filter(({ tokens }) => aliases.some((alias) => aliasMatches(alias, tokens))).map(({ name }) => name)
      );
    } else if (jobMentions && !githubMentions) {
      potentialGaps.push(skill);
    }
  }

  // FINDING #2: a gap means "the JD names this AND the public evidence doesn't show
  // it". When some language evidence was throttled away, "doesn't show it" is
  // unreliable — the skill may live in a language map we couldn't fetch — so a gap
  // must NOT be asserted from missing data. Drop gaps entirely for a partial run.
  // Matches stay: throttling can only REMOVE evidence, so a match that was found is
  // genuinely found. The dropped skills are NOT lost, though: they travel as
  // `undeterminedSkills`, so the skill ledger can name each JD skill it could not
  // determine instead of the panel reading "no gaps" beside a caveat.
  const reliableGaps = languageCoverageComplete ? potentialGaps : [];
  const undeterminedSkills = languageCoverageComplete ? [] : potentialGaps;

  return {
    jobDescriptionProvided,
    matchingSkills,
    potentialGaps: reliableGaps,
    undeterminedSkills,
    skillEvidence,
    // Honest coverage: the comparison is over a fixed taxonomy, so "no gaps" means
    // "no gaps among the tracked skills", not "no gaps". The UI can say so.
    trackedSkillCount: Object.keys(SKILL_ALIASES).length,
    complexityAssessment: complexityAssessment(repos)
  };
}
