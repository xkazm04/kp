// One skill ledger for the GitHub deep-dive.
//
// The panel used to hand a recruiter FIVE independent skill lists from two engines —
// the label comparison's matches and gaps, and the code review's evidenced,
// "unverified" and hidden-strength lists — and left the reconciling to the reader.
// One skill could sit in "Potential gaps" and "Evidenced" at once, no match said
// which repository carried it, and a coral "Unverified claims" column read as an
// accusation.
//
// This module joins the two engines on the canonical skill (skills.ts
// canonicalSkill) and emits one row per skill with one of four verdicts, the
// registry's three buckets plus the coverage-loss state
// (recruiting/public-work-evidence-bounding, corroborate-a-claim-never-replace-it):
//
//   corroborated       a JD skill the public evidence supports — by repo labels
//                      (naming the repos) and/or by the review.
//   notReached         a JD skill the public evidence neither supports nor
//                      contradicts. NEUTRAL: never "unverified", never "missing".
//   couldNotDetermine  a JD skill we could not check because part of the read was
//                      throttled away. An unreadable source is never a negative.
//   unclaimed          a strength the evidence shows that the JD never asked for.
//
// Where the review calls a label-matched skill unverified, the row stays
// corroborated (the label evidence is real and named) and carries
// `reviewDisagrees` — the two statements differ, which is for a human to look at,
// not a verdict.
//
// Pure and import-light. It also OWNS the skill taxonomy (moved here from skills.ts),
// so the client panel loads the ledger without skills.ts's server-side heuristics on
// the workspace page's import graph. It runs in the panel over a stored payload of
// any age (skillEvidence / undeterminedSkills are nullish on old analyses).
import { hasEvidenceIncomplete, type GithubNote } from "../github-evidence.ts";

// --- The tracked skill taxonomy -------------------------------------------------
//
// The tracked skill taxonomy for the GitHub↔JD fit comparison (buildJobFitSignals
// in skills.ts matches over it; the ledger below joins the review onto it). It was
// 10 buckets, so a JD requiring Go/Rust/Java/K8s/security/data-eng could never appear as a match OR a
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
export const SKILL_ALIASES: Record<string, string[]> = {
  python: ["python", "fastapi", "django", "flask", "pandas", "numpy"],
  typescript: ["typescript", "ts"],
  // "node.js" and "nodejs" are listed EXPLICITLY: tokenizeForSkills keeps interior
  // dots (so "node.js" survives as one token rather than splitting to "node"), which
  // meant a JD saying "Node.js required" produced neither a match nor a gap — the
  // silent false-negative shape this taxonomy exists to prevent. Both spellings live
  // ONLY here, so the disjoint-bucket rule still holds (react owns next.js/nextjs).
  javascript: ["javascript", "node", "node.js", "nodejs"],
  react: ["react", "frontend", "ui", "next.js", "nextjs"],
  // Same silent-false-negative shape as node.js: a JD that names Vue or Svelte
  // produced neither a match nor a gap, so "Potential Gaps: none" meant "the
  // taxonomy did not know the skill". Aliases live ONLY here (not also in
  // javascript), so the disjoint-bucket rule still holds.
  vue: ["vue", "vue.js", "vuejs", "nuxt", "nuxt.js"],
  svelte: ["svelte", "sveltekit"],
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
export function tokenizeForSkills(text: string): Set<string> {
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
export function aliasMatches(alias: string, tokens: Set<string>): boolean {
  return alias
    .toLowerCase()
    .split(/\s+/)
    .every((word) => tokens.has(word.replace(/^\.+|\.+$/g, "")));
}

/**
 * Map a free-text skill (the code review's `confirmed_skills` / `unverified_claims` /
 * `hidden_strengths`, or a legacy title-cased label such as "TypeScript") onto the
 * disjoint taxonomy bucket it names, with the same whole-token matching the JD
 * comparison uses — so "Docker" and the label engine's `docker` join as one skill.
 *
 * Returns null when the text names no bucket, AND when it names more than one:
 * "event sourcing" or "Python and Rust" stay free text rather than being forced into
 * a bucket the text does not uniquely mean.
 */
export function canonicalSkill(text: string): string | null {
  const tokens = tokenizeForSkills(text);
  if (tokens.size === 0) return null;
  const buckets = Object.entries(SKILL_ALIASES)
    .filter(([, aliases]) => aliases.some((alias) => aliasMatches(alias, tokens)))
    .map(([skill]) => skill);
  return buckets.length === 1 ? buckets[0] : null;
}

// --- The ledger -----------------------------------------------------------------

export const SKILL_LEDGER_VERDICTS = ["corroborated", "notReached", "couldNotDetermine", "unclaimed"] as const;
export type SkillLedgerVerdict = (typeof SKILL_LEDGER_VERDICTS)[number];
export type SkillLedgerSource = "labels" | "review";

export type SkillLedgerRow = {
  /** Join key: the taxonomy bucket, or the lower-cased free text outside it. */
  skill: string;
  /** What the reader sees: the text the engine that raised the row used (a bucket id, or the review's own wording). */
  label: string;
  verdict: SkillLedgerVerdict;
  /** Which engine(s) produced a corroboration; for other verdicts, which engine raised the row. */
  sources: SkillLedgerSource[];
  /** Repositories whose labels carried a corroboration (empty = language mix / review only). */
  repos: string[];
  /** The review listed this skill as not visible while the labels corroborate it. */
  reviewDisagrees: boolean;
};

type JobFitInput = {
  jobDescriptionProvided: boolean;
  matchingSkills: readonly string[];
  potentialGaps: readonly string[];
  skillEvidence?: Record<string, readonly string[]> | null;
  undeterminedSkills?: readonly string[] | null;
};

type ReviewInput = {
  partial?: boolean | null;
  confirmedSkills: readonly string[];
  unverifiedClaims: readonly string[];
  hiddenStrengths: readonly string[];
};

const VERDICT_ORDER: Record<SkillLedgerVerdict, number> = {
  corroborated: 0,
  notReached: 1,
  couldNotDetermine: 2,
  unclaimed: 3,
};

function keyOf(text: string): { key: string; label: string } | null {
  const label = text.trim();
  if (!label) return null;
  return { key: canonicalSkill(label) ?? label.toLowerCase(), label };
}

function keySet(items: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const item of items) {
    const k = keyOf(item);
    if (k && !out.has(k.key)) out.set(k.key, k.label);
  }
  return out;
}

export function buildSkillLedger(
  jobFit: JobFitInput,
  review: ReviewInput | null | undefined,
  limitations: readonly GithubNote[],
): SkillLedgerRow[] {
  // Coverage loss from either engine: the route's limitation (a throttled language
  // read) or the review's own partial flag (some repo bundles never arrived).
  const incomplete = hasEvidenceIncomplete(limitations) || review?.partial === true;
  const confirmed = keySet(review?.confirmedSkills ?? []);
  const unverified = keySet(review?.unverifiedClaims ?? []);
  const hidden = keySet(review?.hiddenStrengths ?? []);
  const rows = new Map<string, SkillLedgerRow>();

  const add = (row: SkillLedgerRow) => {
    if (!rows.has(row.skill)) rows.set(row.skill, row);
  };

  if (jobFit.jobDescriptionProvided) {
    const evidence = jobFit.skillEvidence ?? {};
    for (const raw of jobFit.matchingSkills) {
      const k = keyOf(raw);
      if (!k) continue;
      add({
        skill: k.key,
        label: k.label,
        verdict: "corroborated",
        sources: confirmed.has(k.key) ? ["labels", "review"] : ["labels"],
        repos: [...(evidence[raw] ?? evidence[k.key] ?? [])],
        reviewDisagrees: unverified.has(k.key),
      });
    }
    // JD skills the labels did not show. A gap on a complete read is not reached;
    // anything on a partial read — including a legacy payload's gap list — could
    // not be determined. The review can still corroborate either.
    const unshown: Array<{ raw: string; undetermined: boolean }> = [
      ...jobFit.potentialGaps.map((raw) => ({ raw, undetermined: incomplete })),
      ...(jobFit.undeterminedSkills ?? []).map((raw) => ({ raw, undetermined: true })),
    ];
    for (const { raw, undetermined } of unshown) {
      const k = keyOf(raw);
      if (!k || rows.has(k.key)) continue;
      const byReview = confirmed.has(k.key);
      add({
        skill: k.key,
        label: k.label,
        verdict: byReview ? "corroborated" : undetermined ? "couldNotDetermine" : "notReached",
        sources: byReview ? ["review"] : ["labels"],
        repos: [],
        reviewDisagrees: false,
      });
    }
    // The review's "unverified claims" are JD skills it could not see in the signals.
    // They are the not-reached bucket — never a column of their own.
    for (const [key, label] of unverified) {
      if (rows.has(key)) continue;
      add({
        skill: key,
        label,
        verdict: incomplete ? "couldNotDetermine" : "notReached",
        sources: ["review"],
        repos: [],
        reviewDisagrees: false,
      });
    }
  }

  // Unclaimed strengths close the ledger: the review's hidden strengths, plus any
  // skill it evidenced that no JD row accounts for (with no JD, that is all of them).
  for (const [key, label] of [...hidden, ...confirmed]) {
    if (rows.has(key)) continue;
    add({ skill: key, label, verdict: "unclaimed", sources: ["review"], repos: [], reviewDisagrees: false });
  }

  return [...rows.values()]
    .map((row, index) => ({ row, index }))
    .sort((a, b) => VERDICT_ORDER[a.row.verdict] - VERDICT_ORDER[b.row.verdict] || a.index - b.index)
    .map(({ row }) => row);
}
