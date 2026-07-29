import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { GoogleGenAI } from "@google/genai";
import { logGithub, newRequestId } from "@/app/_lib/logger";
import { codeReviewSchema, githubAnalysisSchema } from "@/app/_lib/schemas";
import { ACTIVE_WINDOW_MONTHS, RECENT_WINDOW_MONTHS, isWithinMonths } from "@/app/_lib/repo-activity";
import { parseGithubUsername } from "@/app/_lib/github-handle";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";
import {
  COMMITS_PER_REPO,
  FILES_PER_REPO,
  README_TRUNCATE,
  EVIDENCE_INCOMPLETE_NOTE,
  describeEvidenceBasis,
} from "@/app/_lib/github-evidence";
import { withGeminiRetry } from "@/app/_lib/gemini-retry";
import { resolveProviderKey } from "@/app/_lib/llm-config";
import { insertLlmUsage } from "@/app/_lib/db/llm";
import { trackLlmToLightTrack } from "@/app/_lib/llm-lighttrack";

export const maxDuration = 60;

const GEMINI_MODEL = "gemini-3-flash-preview";
const DEEP_REVIEW_REPO_LIMIT = 3;

// USD per million tokens for GEMINI_MODEL — keep in sync with MTOK_PRICES in
// pipeline/jobfit/llm/base.py (Python is the price book of record; this pair
// exists only so the one TS-direct Gemini call stamps the same cost_usd on its
// llm_usage ledger row as the Python adapters do).
const GEMINI_MTOK_PRICE_IN_USD = 0.3;
const GEMINI_MTOK_PRICE_OUT_USD = 2.5;

// In-process TTL cache for the deep-dive (GH5), mirroring the matrix route's
// content-hash cache (same accepted single-process caveat). Each run burns up
// to ~31 GitHub REST calls + one Gemini call, and GitHub's anonymous 60/hr
// rate limit is the route's dominant real-world failure — re-analyzing the
// same candidate within the TTL serves the stored result (with its original
// analyzedAt) instead of burning another budget. Errors are never cached, so
// a rate-limited attempt can be retried immediately.
const GITHUB_CACHE_TTL_MS = 15 * 60 * 1000;
const GITHUB_CACHE_MAX = 20;
const githubCache = new Map<string, { at: number; payload: unknown }>();

// GitHub usernames are case-insensitive — fold the key so Octocat and octocat
// share an entry. The JD is part of the key because jobFitSignals depend on it.
// The JD is NORMALIZED (case/whitespace folded, length-capped) for the key ONLY —
// the analysis still runs against the raw JD. Without this, a trivial JD variation
// (file-extracted vs typed, an extra space, padding) produced a fresh key and turned
// each miss into ~31 GitHub calls + a paid Gemini call: a cheap cost-amplifier.
const GITHUB_CACHE_JD_KEY_MAX = 4000;
function githubCacheKey(username: string, jobDescription: string): string {
  const normJd = jobDescription.toLowerCase().replace(/\s+/g, " ").trim().slice(0, GITHUB_CACHE_JD_KEY_MAX);
  return createHash("sha1").update(`${username.toLowerCase()}\n${normJd}`).digest("hex");
}

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

type GithubUser = {
  login: string;
  html_url: string;
  public_repos: number;
  followers: number;
  // GitHub's /users/{login} resolves ORGANIZATIONS too (they share the exact
  // 1–39 char handle grammar) and returns them with public_repos/followers. `type`
  // ("User" | "Organization" | "Bot") is the ONLY field that says whose account
  // this is — the identity check finding #1 turns from an assumption into a
  // precondition. Without it, an org handle attributes the org's whole portfolio
  // to one candidate.
  type: string;
};

type GithubRepo = {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  fork: boolean;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  updated_at: string;
  pushed_at: string | null;
  topics?: string[];
  size: number;
  open_issues_count: number;
};

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

export async function POST(request: Request) {
  const requestId = newRequestId();
  const startedAt = Date.now();

  const body = await request.json().catch(() => null);
  const rawProfile = typeof body?.profile === "string" ? body.profile.trim() : "";
  const jobDescription = typeof body?.jobDescriptionText === "string" ? body.jobDescriptionText : "";
  const username = parseGithubUsername(rawProfile);

  if (!username) {
    return NextResponse.json({ error: "Enter a GitHub username or profile URL." }, { status: 400 });
  }

  const cacheKey = githubCacheKey(username, jobDescription);
  const hit = githubCache.get(cacheKey);
  if (hit) {
    if (Date.now() - hit.at < GITHUB_CACHE_TTL_MS) {
      return NextResponse.json(hit.payload);
    }
    githubCache.delete(cacheKey);
  }

  // Per-IP abuse containment (backlog #7): an uncached run burns up to ~31
  // GitHub REST calls + one paid Gemini call. The throttle sits AFTER the
  // content-hash cache lookup above so cached responses keep serving freely
  // without consuming budget — only runs that would actually spend external
  // calls count. 10/10min/IP is generous for a human (GitHub's anonymous 60/hr
  // ceiling binds first anyway) while blunting a scripted cost-amplifier. Note
  // this is a real 429, unlike the 200+{error} GitHub-failure envelope below —
  // the shared limiter convention wins, and the panel reads `error` either way.
  if (!rateLimit(`github-analysis:${clientIpFrom(request.headers)}`, { limit: 10, windowMs: 10 * 60_000 })) {
    return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
  }

  try {
    const user = await githubFetch<GithubUser>(`https://api.github.com/users/${encodeURIComponent(username)}`);
    // FINDING #1 (fairness): /users/{login} also resolves organizations, which share
    // the exact handle grammar and return a 200. Attributing an ORG's entire repo
    // portfolio — stars, complexity signals, job-fit — to one applicant is a silent
    // wrong-account failure. Verify "this account is a person" the moment the account
    // is first seen, BEFORE any repo is fetched or analyzed.
    if (user.type !== "User") {
      throw new Error(
        "That handle is a GitHub organization, not a personal account. Enter an individual developer's username."
      );
    }
    // FINDING #3 (edge-case / silent-wrong-result): read the owned-repo list ACROSS
    // pages, not just the first per_page=100. Because sort=updated makes page 1 the
    // NEWEST repos, a prolific candidate (>100 repos) silently lost their oldest —
    // often most-starred / flagship — work from every total below (stars, forks,
    // language mix, the deep-review shortlist). Paginate up to a bounded cap and flag
    // when even that is exceeded so a truncated portfolio is annotated, never presented
    // as complete. Per-page shape validation lives inside the helper.
    const { repos, truncated: reposTruncated } = await fetchOwnedRepoPages(username, user.public_repos);
    const ownedRepos = repos.filter((repo) => !repo.fork);
    const reposForLanguages = ownedRepos.slice(0, 20);
    // FINDING #2 (silent-failure): each /languages sub-fetch swallows its error to
    // {}. GitHub's secondary limiter 403s bursts, so a partial throttle silently
    // drops a repo's secondary languages — which can then surface a skill the
    // candidate HAS as a Potential Gap. Record whether any sub-fetch was a coverage
    // loss (a throttle / 5xx / network error, NOT a genuine 404) so downstream can
    // treat this run as "could not determine" instead of "no evidence". A merely
    // empty language map ({}) that came back 200 is real absence, not a loss.
    let languageCoverageLost = false;
    const languageMaps = await Promise.all(
      reposForLanguages.map((repo) =>
        githubFetch<Record<string, number>>(`https://api.github.com/repos/${repo.full_name}/languages`).catch(
          (error: unknown) => {
            if (isCoverageLossError(error)) languageCoverageLost = true;
            return {} as Record<string, number>;
          }
        )
      )
    );
    const languageCoverageComplete = !languageCoverageLost;

    const languageTotals = mergeLanguageMaps(languageMaps);
    const languageSummary = summarizeLanguages(languageTotals);
    // Rank the owned repos ONCE (on a copy, so the shared ownedRepos array isn't
    // re-sorted in place under later readers) and take both slices from it — top-8
    // for display and the deep-review shortlist — instead of sorting and
    // re-evaluating repoRank twice.
    const rankedRepos = [...ownedRepos].sort((a, b) => repoRank(b) - repoRank(a));
    const topRepositories = rankedRepos
      .slice(0, 8)
      .map((repo) => ({
        name: repo.name,
        url: repo.html_url,
        description: repo.description,
        primaryLanguage: repo.language,
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        updatedAt: repo.updated_at,
        pushedAt: repo.pushed_at,
        topics: repo.topics ?? [],
        complexitySignals: complexitySignals(repo)
      }));

    const totalStars = ownedRepos.reduce((sum, repo) => sum + repo.stargazers_count, 0);
    const totalForks = ownedRepos.reduce((sum, repo) => sum + repo.forks_count, 0);
    // Both windows count code activity (pushed_at), falling back to updated_at only when the
    // repo never reported a push. Named windows + the pushed-vs-updated choice live in
    // repo-activity.ts so these recruiter-facing counts are a decided spec (idea-889dcaf4).
    const activeRepos = ownedRepos.filter((repo) => isWithinMonths(repo.pushed_at ?? repo.updated_at, ACTIVE_WINDOW_MONTHS)).length;
    const recentlyUpdatedRepos = ownedRepos.filter((repo) => isWithinMonths(repo.pushed_at ?? repo.updated_at, RECENT_WINDOW_MONTHS)).length;
    const contributionSignals = buildContributionSignals({
      ownedRepos,
      totalStars,
      totalForks,
      activeRepos,
      recentlyUpdatedRepos,
      languages: languageSummary
    });
    const jobFitSignals = buildJobFitSignals(jobDescription, ownedRepos, languageSummary, languageCoverageComplete);
    const reviewableRepos = rankedRepos.slice(0, DEEP_REVIEW_REPO_LIMIT);
    const codeReview = await runCodeReview(reviewableRepos, jobDescription, requestId);

    const limitations = [
      "Only public GitHub data is visible unless a token with broader access is configured.",
      "GitHub REST does not expose full contribution graphs without GraphQL authentication.",
      "Repository metadata can overstate or understate real production contribution quality.",
    ];
    // FINDING #2: when language coverage was lost to throttling, say so as a
    // first-class limitation. This is the run-level "could not determine" signal the
    // panel keys its Potential-Gaps caveat off (limitations.includes(this)), so a
    // partially-blind run is never presented as a complete one.
    if (!languageCoverageComplete) limitations.push(EVIDENCE_INCOMPLETE_NOTE);
    // FINDING #3: when the owned-repo list was truncated at the page cap, say so as a
    // first-class limitation so a recruiter never reads ownedReposAnalyzed / totalStars
    // as a complete portfolio when older (often most-starred) repos went unanalyzed.
    if (reposTruncated) {
      limitations.push(
        `Only the ${repos.length} most-recently-updated repositories were analyzed of ${user.public_repos} public on this account; older repositories (which may include the most-starred work) were not included in the totals.`
      );
    }

    const payload = {
      username: user.login,
      profileUrl: user.html_url,
      summary: buildSummary(user, ownedRepos, languageSummary, activeRepos),
      analyzedAt: new Date().toISOString(),
      metrics: {
        publicRepos: user.public_repos,
        followers: user.followers,
        totalStars,
        totalForks,
        activeRepos,
        recentlyUpdatedRepos,
        ownedReposAnalyzed: ownedRepos.length
      },
      languages: languageSummary,
      topRepositories,
      contributionSignals,
      jobFitSignals,
      limitations,
      codeReview
    };

    const validated = githubAnalysisSchema.parse(payload);
    githubCache.set(cacheKey, { at: Date.now(), payload: validated });
    if (githubCache.size > GITHUB_CACHE_MAX) {
      // Map iterates in insertion order — drop the oldest entry.
      const oldest = githubCache.keys().next().value;
      if (oldest) githubCache.delete(oldest);
    }
    void logGithub({
      request_id: requestId,
      github_user: username,
      duration_ms: Date.now() - startedAt,
      status: "ok",
      rest_repos: ownedRepos.length,
      code_review_status: codeReview.status,
    });
    return NextResponse.json(validated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub analysis failed.";
    void logGithub({
      request_id: requestId,
      github_user: username,
      duration_ms: Date.now() - startedAt,
      status: "error",
      rest_repos: 0,
      error: message,
    });
    // Optional analysis: surface the failure as a 200 + {error} so the
    // browser console doesn't flag a Bad Gateway every time GitHub rate-limits
    // a request. The frontend reads `error` from the payload regardless of
    // status code and renders it inside the GithubAnalysisPanel error state.
    return NextResponse.json({ error: message });
  }
}

// A GitHub fetch failure that carries the HTTP status, so a caller can tell a
// genuine 404 (the resource is absent — e.g. a repo with no README → real "no
// evidence") apart from a 403/429/5xx throttle (we couldn't read it → "could not
// determine"). FINDING #2 depends on this distinction so normal absences aren't
// mistaken for incomplete coverage, and throttles aren't mistaken for absence.
class GithubHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "GithubHttpError";
    this.status = status;
  }
}

// True when an error means "we couldn't read this", not "it isn't there". A 404 is
// a definitive absence; everything else — a 403/429 secondary-rate-limit, a 5xx, or
// a network throw with no status — is a coverage loss the caller must treat as
// "could not determine" rather than as empty evidence.
function isCoverageLossError(error: unknown): boolean {
  return !(error instanceof GithubHttpError && error.status === 404);
}

async function githubFetch<T>(url: string): Promise<T> {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "kp-jobfit-github-analysis"
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const response = await fetch(url, { headers, next: { revalidate: 0 } });
  if (!response.ok) {
    if (response.status === 404) {
      throw new GithubHttpError(404, "GitHub profile was not found.");
    }
    if (response.status === 403) {
      throw new GithubHttpError(
        403,
        "GitHub rate limit or access policy blocked the request. Configure GITHUB_TOKEN for higher limits."
      );
    }
    throw new GithubHttpError(response.status, `GitHub API returned ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

// FINDING #3 (bug-ui-scan-2026-07-09, github-evidence-cv-utilities): fetch a user's
// owned repos across pages, up to a bounded cap, so a prolific candidate isn't
// truncated to their 100 most-recently-updated repos. Stops early on a short page
// (the natural end of the list); if the whole cap is consumed with a still-full page
// AND GitHub's own public_repos count exceeds what we collected, reports truncated so
// the caller can annotate the undercount instead of implying a complete portfolio.
const REPO_PAGE_SIZE = 100; // GitHub's max per_page for /users/{user}/repos
const REPO_PAGE_CAP = 3; // fetch at most 3×100 = 300 owned repos, bounding the extra REST calls
async function fetchOwnedRepoPages(
  username: string,
  publicRepos: number
): Promise<{ repos: GithubRepo[]; truncated: boolean }> {
  const collected: GithubRepo[] = [];
  let reachedEnd = false;
  for (let page = 1; page <= REPO_PAGE_CAP; page++) {
    const pageRepos = await githubFetch<GithubRepo[]>(
      `https://api.github.com/users/${encodeURIComponent(username)}/repos?per_page=${REPO_PAGE_SIZE}&sort=updated&type=owner&page=${page}`
    );
    // GitHub can return a 200 whose body is an object (e.g. a secondary-rate-limit
    // notice), not the declared array — `.filter` would then throw an opaque "is not a
    // function". Validate every page so the failure is a clear, logged error.
    if (!Array.isArray(pageRepos)) {
      throw new Error("Unexpected GitHub response shape (expected a repository array).");
    }
    collected.push(...pageRepos);
    if (pageRepos.length < REPO_PAGE_SIZE) {
      reachedEnd = true;
      break;
    }
  }
  // Truncated only when we stopped at the cap (not on a short page) AND GitHub reports
  // more public repos than we collected — i.e. real repos actually went unanalyzed.
  const truncated = !reachedEnd && collected.length < publicRepos;
  return { repos: collected, truncated };
}

function mergeLanguageMaps(maps: Array<Record<string, number>>) {
  const totals = new Map<string, number>();
  for (const map of maps) {
    for (const [name, bytes] of Object.entries(map)) {
      totals.set(name, (totals.get(name) ?? 0) + bytes);
    }
  }
  return totals;
}

function summarizeLanguages(totals: Map<string, number>) {
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

function repoRank(repo: GithubRepo) {
  return (
    repo.stargazers_count * REPO_RANK_STAR_WEIGHT +
    repo.forks_count * REPO_RANK_FORK_WEIGHT +
    repo.size / REPO_RANK_SIZE_DIVISOR +
    (isWithinMonths(repo.pushed_at ?? repo.updated_at, REPO_RANK_RECENT_MONTHS) ? REPO_RANK_RECENT_BONUS : 0)
  );
}

function complexitySignals(repo: GithubRepo) {
  const signals: string[] = [];
  if (repo.size > COMPLEXITY_SIZE_KB) signals.push("large codebase footprint");
  if (repo.stargazers_count >= COMPLEXITY_STARS) signals.push("external interest through stars");
  if (repo.forks_count >= COMPLEXITY_FORKS) signals.push("forked by other developers");
  if ((repo.topics ?? []).some((topic) => /test|ci|docker|kubernetes|deploy|infra|automation/i.test(topic))) {
    signals.push("delivery or engineering-practice topic");
  }
  if (repo.open_issues_count > 0) signals.push("issue-tracked project");
  // A distinct "recently maintained" heuristic for the complexity signal, separate
  // from the named Active/Recent tile windows (repo-activity.ts) — kept local on purpose.
  if (isWithinMonths(repo.pushed_at ?? repo.updated_at, COMPLEXITY_RECENT_MONTHS)) signals.push("recently maintained");
  return signals.length ? signals : ["metadata-only signal"];
}

function buildContributionSignals(input: {
  ownedRepos: GithubRepo[];
  totalStars: number;
  totalForks: number;
  activeRepos: number;
  recentlyUpdatedRepos: number;
  languages: Array<{ name: string; percent: number }>;
}) {
  const signals = [
    `${input.ownedRepos.length} owned public repositories analyzed.`,
    `${input.activeRepos} repositories had code activity in the last ${ACTIVE_WINDOW_MONTHS} months; ${input.recentlyUpdatedRepos} in the last ${RECENT_WINDOW_MONTHS} months.`,
    `${input.totalStars} total stars and ${input.totalForks} total forks across owned repositories.`
  ];
  if (input.languages.length) {
    signals.push(`Dominant public language mix: ${input.languages.slice(0, 4).map((lang) => `${lang.name} ${lang.percent}%`).join(", ")}.`);
  }
  return signals;
}

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

function buildJobFitSignals(
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

  const complexRepos = repos.filter((repo) => complexitySignals(repo).length > COMPLEXITY_MIN_SIGNALS).length;
  const complexityAssessment =
    complexRepos >= COMPLEX_REPOS_STRONG
      ? "Public repositories show multiple complexity signals across maintained, non-trivial projects."
      : complexRepos >= COMPLEX_REPOS_SOME
        ? "Public repositories show some complexity signals, but the LLM should inspect repo substance before treating them as production-grade evidence."
        : "Public metadata is thin; treat GitHub as weak supplemental evidence unless deeper repo review is performed.";

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
    complexityAssessment
  };
}

function buildSummary(
  user: GithubUser,
  repos: GithubRepo[],
  languages: Array<{ name: string; percent: number }>,
  activeRepos: number
) {
  const topLanguages = languages.slice(0, 3).map((language) => language.name).join(", ") || "no dominant public language";
  return `${user.login} has ${repos.length} owned public repositories, ${activeRepos} active in the last year, with public language evidence led by ${topLanguages}.`;
}

type RepoBundle = {
  name: string;
  language: string | null;
  topics: string[];
  description: string | null;
  readme: string;
  recentCommits: string[];
  files: string[];
};

async function fetchRepoBundle(repo: GithubRepo): Promise<{ bundle: RepoBundle; incomplete: boolean }> {
  // FINDING #2: each sub-fetch swallows its failure to a benign default, so a
  // throttled bundle is indistinguishable from a genuinely empty one. Record a
  // coverage loss (throttle / 5xx / network — NOT a genuine 404 like "no README")
  // so runCodeReview can tell a partial read from a truly empty repo.
  let incomplete = false;
  const onLoss =
    <T,>(fallback: T) =>
    (error: unknown): T => {
      if (isCoverageLossError(error)) incomplete = true;
      return fallback;
    };
  const [readmeText, commits, contents] = await Promise.all([
    fetchReadme(repo.full_name).catch(onLoss("")),
    githubFetch<Array<{ commit?: { message?: string } }>>(
      `https://api.github.com/repos/${repo.full_name}/commits?per_page=${COMMITS_PER_REPO}`
    ).catch(onLoss([] as Array<{ commit?: { message?: string } }>)),
    githubFetch<Array<{ name: string; type: string }>>(
      `https://api.github.com/repos/${repo.full_name}/contents`
    ).catch(onLoss([] as Array<{ name: string; type: string }>)),
  ]);

  return {
    bundle: {
      name: repo.name,
      language: repo.language,
      topics: repo.topics ?? [],
      description: repo.description,
      readme: readmeText.slice(0, README_TRUNCATE),
      recentCommits: commits
        .map((c) => c.commit?.message?.split("\n")[0] ?? "")
        .filter(Boolean)
        .slice(0, COMMITS_PER_REPO),
      files: contents
        .map((entry) => `${entry.type === "dir" ? "[d] " : ""}${entry.name}`)
        .slice(0, FILES_PER_REPO),
    },
    incomplete,
  };
}

async function fetchReadme(fullName: string): Promise<string> {
  const data = await githubFetch<{ content?: string; encoding?: string }>(
    `https://api.github.com/repos/${fullName}/readme`
  );
  if (!data?.content) return "";
  if (data.encoding === "base64") {
    return Buffer.from(data.content, "base64").toString("utf-8");
  }
  return data.content;
}

// Derived from the single codeReviewSchema (app/_lib/schemas) so this payload,
// the GithubAnalysis schema and the e2e fixture can't silently drift apart.
type CodeReviewPayload = z.infer<typeof codeReviewSchema>;

// describeEvidenceBasis + the README_TRUNCATE / COMMITS_PER_REPO / FILES_PER_REPO
// limits live in @/app/_lib/github-evidence so this route and the e2e fixture
// share one source of truth (the fixture used to hardcode the numbers by value).

// Shape the Gemini model is asked to emit (snake_case). Each field .catch()es to
// a safe default so a malformed/partial field snaps to empty instead of throwing,
// and safeParse on a non-object returns failure (-> we flag a malformed payload).
const geminiReviewSchema = z.object({
  summary: z.string().catch(""),
  confirmed_skills: z.array(z.string()).catch([]),
  unverified_claims: z.array(z.string()).catch([]),
  hidden_strengths: z.array(z.string()).catch([]),
});

async function runCodeReview(
  repos: GithubRepo[],
  jobDescription: string,
  requestId?: string
): Promise<CodeReviewPayload> {
  const reposReviewed = repos.map((repo) => repo.name);
  // Documented only for paths where the review actually assembles evidence; the
  // disabled / no-repos branches read nothing, so they advertise no basis.
  const evidenceBasis = describeEvidenceBasis();
  // Key resolution follows the app's documented layering (docs/LLM_PROVIDER_LAYER.md,
  // resolveProviderKey): UI-entered BYOM key row → platform key row → env var
  // (GEMINI_API_KEY, then GOOGLE_API_KEY). This route used to read only the env
  // vars, so a workspace running purely on a BYOM Gemini key silently got the
  // "disabled" review. A configured-but-undecryptable stored key throws (KP_SECRET
  // changed/missing) — surface that as a review error, not as key-not-configured.
  let apiKey: string | undefined;
  try {
    apiKey = resolveProviderKey("gemini", ["GEMINI_API_KEY", "GOOGLE_API_KEY"]);
  } catch (error) {
    return {
      status: "error",
      summary: "A Gemini provider key is configured but could not be decrypted (check KP_SECRET).",
      confirmedSkills: [],
      unverifiedClaims: [],
      hiddenStrengths: [],
      reposReviewed,
      evidenceBasis: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (!apiKey) {
    return {
      status: "disabled",
      summary: "Set GEMINI_API_KEY (or add a Gemini key in Models → Keys) to enable Gemini-based repo-signal review.",
      confirmedSkills: [],
      unverifiedClaims: [],
      hiddenStrengths: [],
      reposReviewed,
      evidenceBasis: [],
      error: null,
    };
  }
  if (repos.length === 0) {
    // Distinct from "ok": the review ran successfully but found nothing to
    // review, so consumers must not read this as evidenced-skills data.
    return {
      status: "empty",
      summary: "No owned public repositories were available to review.",
      confirmedSkills: [],
      unverifiedClaims: [],
      hiddenStrengths: [],
      reposReviewed,
      evidenceBasis: [],
      error: null,
    };
  }

  let results: Array<{ bundle: RepoBundle; incomplete: boolean }>;
  try {
    results = await Promise.all(repos.map(fetchRepoBundle));
  } catch (error) {
    return {
      status: "error",
      summary: "Failed to fetch repository signals for deep review.",
      confirmedSkills: [],
      unverifiedClaims: [],
      hiddenStrengths: [],
      reposReviewed,
      evidenceBasis,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const bundles = results.map((r) => r.bundle);
  // FINDING #2: was any sub-fetch a coverage loss (throttle/5xx/network, not a
  // genuine 404)? If so this is a PARTIAL read, not a complete one.
  const coverageIncomplete = results.some((r) => r.incomplete);

  // fetchRepoBundle swallows each sub-fetch to a benign default ("" / []), so a
  // rate-limited or 5xx run yields bundles with no readme, commits, or files yet
  // Promise.all still "succeeds". Distinguish three states instead of the old binary
  // any-signal-vs-none, so "partially blind" is never mistaken for "complete".
  const hasAnySignal = bundles.some(
    (b) => b.readme.trim() || b.recentCommits.length > 0 || b.files.length > 0
  );
  if (!hasAnySignal) {
    // COULD NOT DETERMINE: no signal AND a sub-fetch was throttled/errored — almost
    // always a transient rate limit, not empty repos. Sending it to Gemini would
    // fabricate a confident assessment from nothing, so fail loudly.
    if (coverageIncomplete) {
      return {
        status: "error",
        summary: "Couldn't gather public repo signals — GitHub may be rate-limiting (could not determine). Try again shortly.",
        confirmedSkills: [],
        unverifiedClaims: [],
        hiddenStrengths: [],
        reposReviewed,
        evidenceBasis,
        error: "could_not_determine: repo signal fetch throttled/errored across all repos",
      };
    }
    // NO EVIDENCE: every sub-fetch succeeded and still returned nothing — the repos
    // genuinely expose no README/commit/file signals. A real, successful "empty"
    // (distinct from could-not-determine), so consumers don't read it as data.
    return {
      status: "empty",
      summary: "Reviewed repositories expose no public README, commit, or file signals to assess.",
      confirmedSkills: [],
      unverifiedClaims: [],
      hiddenStrengths: [],
      reposReviewed,
      evidenceBasis,
      error: null,
    };
  }

  const evidenceJson = JSON.stringify(
    bundles.map((b) => ({
      name: b.name,
      language: b.language,
      topics: b.topics,
      description: b.description,
      files: b.files,
      recentCommits: b.recentCommits,
      readme: b.readme,
    })),
    null,
    2
  );

  const prompt = [
    "You are a precise senior engineer reviewing public GitHub repo *signals* for hiring evidence.",
    "You are NOT reading the source code. You only receive lightweight public signals: README text (truncated), recent commit subject lines, root-level file/directory NAMES (no file contents), the primary language, and topics.",
    "Decide which technical skills are demonstrably evidenced by these public repo signals, which are *claimed* in the job description but absent from the signals, and which strengths the signals reveal that the job description didn't ask for.",
    "Be conservative: do not infer code quality, architecture, or implementation details you cannot see. Treat a skill as evidenced only when the visible signals directly support it.",
    "In the summary, name any MUST-HAVE job-description skills that are NOT evidenced by the signals explicitly — never imply full coverage (e.g. do not say 'matches N of N must-haves') when a required skill is unproven.",
    "Output ONLY a JSON object matching this shape — no markdown fences, no commentary:",
    `{"summary": "2-3 sentence overall assessment of what the public repo signals show.", "confirmed_skills": ["skill evidenced by the signals"], "unverified_claims": ["jd skill not visible in the repo signals"], "hidden_strengths": ["skill in the signals but not in jd"]}`,
    "",
    "Job description (may be empty):",
    jobDescription || "(none supplied)",
    "",
    "Repository signals (metadata and text only — no file bodies):",
    evidenceJson,
  ].join("\n");

  try {
    const ai = new GoogleGenAI({ apiKey });
    // Bounded retry on transient failures only (429/5xx/timeouts) — this was the
    // one Gemini call site in the app with no retry, so a single rate-limit blip
    // hard-failed the whole review. Policy mirrors the Python side (llm/base.py):
    // 3 attempts, jittered exponential backoff; permanent errors (auth, 400)
    // still fail fast into the catch below.
    const geminiStartedAt = Date.now();
    const response = await withGeminiRetry(() =>
      ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          temperature: 0.1,
          maxOutputTokens: 4000,
          responseMimeType: "application/json",
        },
      })
    );
    recordGeminiUsage(requestId, response.usageMetadata, Date.now() - geminiStartedAt);
    const text = response.text ?? "";
    const review = geminiReviewSchema.safeParse(parseGeminiJson(text));
    if (!review.success) {
      return {
        status: "error",
        summary: "Gemini returned a malformed repo-signal review payload.",
        confirmedSkills: [],
        unverifiedClaims: [],
        hiddenStrengths: [],
        reposReviewed,
        evidenceBasis,
        error: "non-json response",
      };
    }
    return {
      status: "ok",
      // FINDING #2: EVIDENCE FOUND but partial — some repo data couldn't be fetched
      // this run. The review is real, but stamping the caveat onto the summary (which
      // the panel renders and the board evidence summary carries) removes the false
      // confidence of an authoritative read built on a fraction of the evidence.
      summary: coverageIncomplete
        ? `${review.data.summary} (Partial evidence: some repository data couldn't be fetched this run — likely rate limiting — so treat this as an incomplete read.)`
        : review.data.summary,
      confirmedSkills: review.data.confirmed_skills,
      unverifiedClaims: review.data.unverified_claims,
      hiddenStrengths: review.data.hidden_strengths,
      reposReviewed,
      evidenceBasis,
      error: null,
    };
  } catch (error) {
    return {
      status: "error",
      summary: "Gemini repo-signal review request failed.",
      confirmedSkills: [],
      unverifiedClaims: [],
      hiddenStrengths: [],
      reposReviewed,
      evidenceBasis,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Stamp the deep-review Gemini call into BOTH telemetry sinks — the durable
// llm_usage ledger and LightTrack. The LLM-cost audit flagged this site as the
// app's only TS-direct Gemini traffic (every Python call meters via
// monitor.emit_result; this is the one call that never reaches Python), so it is
// the one place the TS runtime has to mirror what the Python monitor does. Both
// writes happen only when the response carries usage metadata, and both are
// wrapped so telemetry I/O can never break the analysis: metering is off the
// critical path (same contract as ingestLlmUsageLog / gemini.py _meter_success).
function recordGeminiUsage(
  requestId: string | undefined,
  usage: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number } | undefined,
  latencyMs?: number
): void {
  if (!usage) return;
  const inputTokens = typeof usage.promptTokenCount === "number" ? usage.promptTokenCount : null;
  const outputTokens = typeof usage.candidatesTokenCount === "number" ? usage.candidatesTokenCount : null;
  if (inputTokens === null && outputTokens === null) return;
  const cachedTokens = typeof usage.cachedContentTokenCount === "number" ? usage.cachedContentTokenCount : null;
  const costUsd = round6(
    ((inputTokens ?? 0) * GEMINI_MTOK_PRICE_IN_USD + (outputTokens ?? 0) * GEMINI_MTOK_PRICE_OUT_USD) / 1_000_000
  );
  // Durable spend ledger — written first, independent of LightTrack below (same
  // ordering as gemini.py _meter_success: the ledger must persist even when
  // observability is off, the default deployment).
  try {
    insertLlmUsage({
      useCase: "github_analysis",
      provider: "gemini",
      model: GEMINI_MODEL,
      inputTokens,
      outputTokens,
      cachedTokens,
      costUsd,
      source: "llm",
      requestId: requestId ?? null,
    });
  } catch {
    // metering must never break the host call
  }
  // Observability mirror: surface this TS-direct call in LightTrack alongside
  // every Python-metered call, so the one pane of glass isn't missing it. No-op
  // unless LIGHTTRACK_URL is set; best-effort and exception-swallowed.
  trackLlmToLightTrack({
    provider: "gemini",
    model: GEMINI_MODEL,
    useCase: "github_analysis",
    inputTokens,
    outputTokens,
    cachedTokens,
    costUsd,
    latencyMs,
  });
}

// Six-decimal rounding for cost_usd, matching Python's price_usd (llm/base.py).
function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

// Parse the model's JSON, tolerating an optional ```json fence, and return the
// raw value for geminiReviewSchema.safeParse to validate + default. Replaces the
// old brace-matching regex, which could splice a partial object out of prose.
function parseGeminiJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(unfenced);
  } catch {
    return null;
  }
}
