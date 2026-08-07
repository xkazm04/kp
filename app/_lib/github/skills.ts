import type { GithubRepo } from "./client";
import { complexityAssessment } from "./heuristics";

// The tracked skill taxonomy for the GitHub↔JD fit comparison. Was 10 buckets, so a
// JD requiring Go/Rust/Java/K8s/security/data-eng could never appear as a match OR a
// gap — a recruiter saw "Potential Gaps: none" and read it as "no gaps" when it meant
// "no gaps among 10 hard-coded skills" (a false-reassurance wrong-hiring signal).
// aliasMatches is WHOLE-TOKEN (tokenizeForSkills keeps + # .), so short aliases like
// "go"/"c#"/"c++" can't substring-match ("go" ≠ "google"). The job-fit signals expose
// trackedSkillCount so the UI can say "compared against N tracked skills", honestly.
//
// FINDING #4 (bug-ui-scan-2026-07-09, github-evidence-cv-utilities): the buckets are
// counted as DISJOINT concepts (one match/gap each), so an alias that lives in several
// buckets fans one JD keyword into several verdicts — "react" used to sit in
// typescript + javascript + react, turning a single React gap into THREE gap bullets
// (and a React-only candidate into three "matches", inflating apparent breadth). The
// alias sets are now mutually exclusive: "react"/"next.js"/"nextjs" belong only to the
// `react` bucket, so one underlying skill can produce at most one verdict.
const SKILL_ALIASES: Record<string, string[]> = {
  python: ["python", "fastapi", "django", "flask", "pandas", "numpy"],
  typescript: ["typescript", "ts"],
  javascript: ["javascript", "node"],
  react: ["react", "frontend", "ui", "next.js", "nextjs"],
  go: ["go", "golang"],
  rust: ["rust"],
  java: ["java", "spring", "jvm"],
  csharp: ["c#", "csharp", ".net", "dotnet"],
  cpp: ["c++", "cpp"],
  php: ["php", "laravel", "symfony"],
  ruby: ["ruby", "rails"],
  swift: ["swift", "ios"],
  kotlin: ["kotlin", "android"],
  mobile: ["mobile", "react native", "flutter"],
  docker: ["docker", "container"],
  kubernetes: ["kubernetes", "k8s", "helm"],
  iac: ["terraform", "ansible", "pulumi", "iac"],
  sql: ["sql", "postgres", "mysql", "sqlite", "database"],
  nosql: ["mongodb", "redis", "cassandra", "dynamodb", "nosql"],
  graphql: ["graphql", "apollo"],
  data_engineering: ["spark", "kafka", "airflow", "etl", "snowflake", "dbt", "databricks"],
  ai: ["ai", "llm", "rag", "openai", "gemini", "agent", "automation"],
  cloud: ["aws", "azure", "gcp", "cloud"],
  security: ["security", "appsec", "infosec", "owasp", "pentest", "cryptography"],
  testing: ["test", "testing", "playwright", "pytest", "jest", "vitest"],
  ci: ["ci", "github actions", "pipeline", "devops"]
};

// Tokenize text into a set of word tokens for boundary-accurate skill matching.
// Splits on anything that isn't an alphanumeric or a tech-symbol (+ # .), then
// strips leading/trailing dots so "node.js" survives but a sentence-final "ai."
// normalizes to "ai".
function tokenizeForSkills(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9+#.]+/)
      .map((t) => t.replace(/^\.+|\.+$/g, ""))
      .filter(Boolean)
  );
}

// A skill alias matches only when every word of it is present as a real token,
// so the 2-letter "ai"/"ts"/"ci" can't phantom-match inside longer words.
function aliasMatches(alias: string, tokens: Set<string>): boolean {
  return alias
    .toLowerCase()
    .split(/\s+/)
    .every((word) => tokens.has(word.replace(/^\.+|\.+$/g, "")));
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
      ...repos.flatMap((repo) => [repo.name, repo.description ?? "", repo.language ?? "", ...(repo.topics ?? [])]),
      ...languages.map((language) => language.name)
    ].join(" ")
  );
  const jobTokens = tokenizeForSkills(jobDescription);
  const matchingSkills: string[] = [];
  const potentialGaps: string[] = [];

  for (const [skill, aliases] of Object.entries(SKILL_ALIASES)) {
    const jobMentions = aliases.some((alias) => aliasMatches(alias, jobTokens));
    const githubMentions = aliases.some((alias) => aliasMatches(alias, haystackTokens));
    if (jobMentions && githubMentions) {
      matchingSkills.push(skill);
    } else if (jobMentions && !githubMentions) {
      potentialGaps.push(skill);
    }
  }

  // FINDING #2: a gap means "the JD names this AND the public evidence doesn't show
  // it". When some language evidence was throttled away, "doesn't show it" is
  // unreliable — the skill may live in a language map we couldn't fetch — so a gap
  // must NOT be asserted from missing data. Drop gaps entirely for a partial run and
  // let the panel + limitations surface "could not determine". Matches stay:
  // throttling can only REMOVE evidence, so a match that was found is genuinely found.
  const reliableGaps = languageCoverageComplete ? potentialGaps : [];

  return {
    jobDescriptionProvided,
    matchingSkills,
    potentialGaps: reliableGaps,
    // Honest coverage: the comparison is over a fixed taxonomy, so "no gaps" means
    // "no gaps among the tracked skills", not "no gaps". The UI can say so.
    trackedSkillCount: Object.keys(SKILL_ALIASES).length,
    complexityAssessment: complexityAssessment(repos)
  };
}
