import { ACTIVE_WINDOW_MONTHS, RECENT_WINDOW_MONTHS, isWithinMonths } from "@/app/_lib/repo-activity";
import type { GithubFinding } from "@/app/_lib/github-evidence";
import type { GithubRepo, GithubUser } from "./client";

// --- Repo ranking & complexity heuristics ----------------------------------
// These constants decide which of a candidate's repos surface as hiring
// evidence and how their complexity is described in the analysis. They feed a
// hiring-facing score, so they are grouped and documented here to stay
// auditable: a future maintainer can re-tune a weight or threshold in one place
// without reverse-engineering the math, and can't accidentally misread a unit.
//
// UNIT NOTE — repo.size is GitHub's reported size in KILOBYTES (per the REST
// API), NOT bytes and NOT lines of code. So `size > COMPLEXITY_SIZE_KB` (5000)
// means roughly "larger than ~5 MB", and `size / REPO_RANK_SIZE_DIVISOR` turns
// KB into a small, bounded ranking contribution.

// repoRank() weights — a repo's rank is a weighted sum used to order the
// "top repositories" list and to pick which repos get a deep code review.
const REPO_RANK_STAR_WEIGHT = 4; // points per star; stars are the strongest public-interest signal, so weighted highest
const REPO_RANK_FORK_WEIGHT = 3; // points per fork; forks signal reuse/collaboration, weighted just below stars
const REPO_RANK_SIZE_DIVISOR = 500; // size(KB) ÷ 500 → at most a few points, so a large repo can't out-rank real traction
const REPO_RANK_RECENT_BONUS = 20; // flat bonus for a repo pushed within REPO_RANK_RECENT_MONTHS; favors maintained work
const REPO_RANK_RECENT_MONTHS = 12; // "recent" window (months) for the repoRank freshness bonus

// complexitySignals() thresholds — each crossed threshold adds one
// human-readable "this repo is non-trivial" signal. The bar is intentionally
// low because these are supplemental hints, not a verdict.
const COMPLEXITY_SIZE_KB = 5000; // > 5000 KB (~5 MB) counts as a "large codebase footprint"
const COMPLEXITY_STARS = 10; // >= 10 stars counts as "external interest through stars"
const COMPLEXITY_FORKS = 3; // >= 3 forks counts as "forked by other developers"
const COMPLEXITY_RECENT_MONTHS = 6; // pushed within 6 months counts as "recently maintained"

// complexityAssessment cutoffs — a repo is "complex" when it shows MORE than
// COMPLEXITY_MIN_SIGNALS signals (i.e. at least two). The count of such repos
// then escalates the overall assessment wording.
const COMPLEXITY_MIN_SIGNALS = 1; // a repo counts as "complex" when its signal count exceeds this (>= 2 signals)
const COMPLEX_REPOS_STRONG = 4; // >= 4 complex repos → strongest "multiple complexity signals" wording
const COMPLEX_REPOS_SOME = 1; // >= 1 complex repo → cautious "inspect substance before trusting" wording

/** One language's share of the analyzed portfolio, as summarizeLanguages emits it. */
export type LanguageShare = { name: string; bytes: number; percent: number };

export function mergeLanguageMaps(maps: Array<Record<string, number>>) {
  const totals = new Map<string, number>();
  for (const map of maps) {
    for (const [name, bytes] of Object.entries(map)) {
      totals.set(name, (totals.get(name) ?? 0) + bytes);
    }
  }
  return totals;
}

export function summarizeLanguages(totals: Map<string, number>): LanguageShare[] {
  const totalBytes = [...totals.values()].reduce((sum, value) => sum + value, 0) || 1;
  return [...totals.entries()]
    .map(([name, bytes]) => ({
      name,
      bytes,
      percent: Math.round((bytes / totalBytes) * 1000) / 10
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10);
}

export function repoRank(repo: GithubRepo) {
  return (
    repo.stargazers_count * REPO_RANK_STAR_WEIGHT +
    repo.forks_count * REPO_RANK_FORK_WEIGHT +
    repo.size / REPO_RANK_SIZE_DIVISOR +
    (isWithinMonths(repo.pushed_at ?? repo.updated_at, REPO_RANK_RECENT_MONTHS) ? REPO_RANK_RECENT_BONUS : 0)
  );
}

// The six signals are a CLOSED SET — data, not copy — so each is emitted as a
// finding and named by the `results.github.finding.signal.*` catalog at render.
export function complexitySignals(repo: GithubRepo): GithubFinding[] {
  const signals: GithubFinding[] = [];
  if (repo.size > COMPLEXITY_SIZE_KB) signals.push({ kind: "signal.largeCodebase" });
  if (repo.stargazers_count >= COMPLEXITY_STARS) signals.push({ kind: "signal.stars" });
  if (repo.forks_count >= COMPLEXITY_FORKS) signals.push({ kind: "signal.forks" });
  if ((repo.topics ?? []).some((topic) => /test|ci|docker|kubernetes|deploy|infra|automation/i.test(topic))) {
    signals.push({ kind: "signal.deliveryTopic" });
  }
  if (repo.open_issues_count > 0) signals.push({ kind: "signal.issues" });
  // A distinct "recently maintained" heuristic for the complexity signal, separate
  // from the named Active/Recent tile windows (repo-activity.ts) — kept local on purpose.
  if (isWithinMonths(repo.pushed_at ?? repo.updated_at, COMPLEXITY_RECENT_MONTHS)) {
    signals.push({ kind: "signal.maintained" });
  }
  return signals.length ? signals : [{ kind: "signal.metadataOnly" }];
}

// How many of a candidate's repos clear the "complex" bar, escalated into the one
// recruiter-facing sentence the job-fit signals carry. Lives next to the cutoffs it
// reads so a threshold and the wording it drives can't be tuned apart.
export function complexityAssessment(repos: GithubRepo[]): GithubFinding {
  const complexRepos = repos.filter((repo) => complexitySignals(repo).length > COMPLEXITY_MIN_SIGNALS).length;
  return complexRepos >= COMPLEX_REPOS_STRONG
    ? { kind: "assessment.strong" }
    : complexRepos >= COMPLEX_REPOS_SOME
      ? { kind: "assessment.some" }
      : { kind: "assessment.thin" };
}

// Counts and window lengths as PARAMS, never pre-formatted into a sentence: ICU
// then does the number formatting and the plural agreement (Czech needs one/few/
// other on every one of these counts) in the reader's language.
export function buildContributionSignals(input: {
  ownedRepos: GithubRepo[];
  totalStars: number;
  totalForks: number;
  activeRepos: number;
  recentlyUpdatedRepos: number;
  languages: Array<{ name: string; percent: number }>;
}): GithubFinding[] {
  const signals: GithubFinding[] = [
    { kind: "contribution.repos", params: { count: input.ownedRepos.length } },
    {
      kind: "contribution.activity",
      params: {
        active: input.activeRepos,
        activeMonths: ACTIVE_WINDOW_MONTHS,
        recent: input.recentlyUpdatedRepos,
        recentMonths: RECENT_WINDOW_MONTHS
      }
    },
    { kind: "contribution.traction", params: { stars: input.totalStars, forks: input.totalForks } }
  ];
  if (input.languages.length) {
    // Names only. The per-language percentages are rendered right beside this, in
    // the Language Mix meters, where each one is a formatted number rather than a
    // "40%" baked into a sentence (cs writes "40 %", fr spaces differently).
    signals.push({
      kind: "contribution.languages",
      params: { mix: input.languages.slice(0, 4).map((lang) => lang.name).join(", ") }
    });
  }
  return signals;
}

/** The headline sentence, in both readings: canonical English for the server log
 *  and for the frozen pipeline-entry evidence summary, plus the same facts as a
 *  finding for the panel to compose in the reader's language. */
export function buildSummary(
  user: GithubUser,
  repos: GithubRepo[],
  languages: Array<{ name: string; percent: number }>,
  activeRepos: number
): { text: string; finding: GithubFinding } {
  const names = languages.slice(0, 3).map((language) => language.name);
  const topLanguages = names.join(", ");
  const params = { login: user.login, repos: repos.length, active: activeRepos };
  return {
    text: `${user.login} has ${repos.length} owned public repositories, ${activeRepos} active in the last year, with public language evidence led by ${topLanguages || "no dominant public language"}.`,
    finding: topLanguages
      ? { kind: "summary.text", params: { ...params, languages: topLanguages } }
      : { kind: "summary.noLanguages", params }
  };
}
