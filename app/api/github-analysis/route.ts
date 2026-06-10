import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { GoogleGenAI } from "@google/genai";
import { logGithub, newRequestId } from "@/app/_lib/logger";
import { codeReviewSchema, githubAnalysisSchema } from "@/app/_lib/schemas";
import { ACTIVE_WINDOW_MONTHS, RECENT_WINDOW_MONTHS, isWithinMonths } from "@/app/_lib/repo-activity";
import {
  COMMITS_PER_REPO,
  FILES_PER_REPO,
  README_TRUNCATE,
  describeEvidenceBasis,
} from "@/app/_lib/github-evidence";

export const runtime = "nodejs";
export const maxDuration = 60;

const GEMINI_MODEL = "gemini-3-flash-preview";
const DEEP_REVIEW_REPO_LIMIT = 3;

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
function githubCacheKey(username: string, jobDescription: string): string {
  return createHash("sha1").update(`${username.toLowerCase()}\n${jobDescription}`).digest("hex");
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

const SKILL_ALIASES: Record<string, string[]> = {
  python: ["python", "fastapi", "django", "flask", "pandas", "numpy"],
  typescript: ["typescript", "ts", "next.js", "nextjs", "react"],
  javascript: ["javascript", "node", "react", "next.js", "nextjs"],
  react: ["react", "frontend", "ui"],
  docker: ["docker", "container"],
  sql: ["sql", "postgres", "mysql", "sqlite", "database"],
  ai: ["ai", "llm", "rag", "openai", "gemini", "agent", "automation"],
  cloud: ["aws", "azure", "gcp", "cloud"],
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

  try {
    const user = await githubFetch<GithubUser>(`https://api.github.com/users/${encodeURIComponent(username)}`);
    const repos = await githubFetch<GithubRepo[]>(
      `https://api.github.com/users/${encodeURIComponent(username)}/repos?per_page=100&sort=updated&type=owner`
    );
    // GitHub can return a 200 whose body is an object (e.g. a secondary-rate-limit notice),
    // not the declared array — `repos.filter` would then throw an opaque "is not a function".
    // Validate the shape so the failure is a clear, logged error the panel can surface.
    if (!Array.isArray(repos)) {
      throw new Error("Unexpected GitHub response shape (expected a repository array).");
    }
    const ownedRepos = repos.filter((repo) => !repo.fork);
    const reposForLanguages = ownedRepos.slice(0, 20);
    const languageMaps = await Promise.all(
      reposForLanguages.map((repo) =>
        githubFetch<Record<string, number>>(`https://api.github.com/repos/${repo.full_name}/languages`).catch(() => ({}))
      )
    );

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
    const jobFitSignals = buildJobFitSignals(jobDescription, ownedRepos, languageSummary);
    const reviewableRepos = rankedRepos.slice(0, DEEP_REVIEW_REPO_LIMIT);
    const codeReview = await runCodeReview(reviewableRepos, jobDescription);

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
      limitations: [
        "Only public GitHub data is visible unless a token with broader access is configured.",
        "GitHub REST does not expose full contribution graphs without GraphQL authentication.",
        "Repository metadata can overstate or understate real production contribution quality."
      ],
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

function parseGithubUsername(input: string) {
  if (!input) return null;
  const trimmed = input.trim().replace(/\/+$/, "");
  const urlMatch = trimmed.match(/^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)(?:[/?#].*)?$/i);
  const candidate = urlMatch ? urlMatch[1] : trimmed.replace(/^@/, "");
  if (!/^[A-Za-z0-9-]{1,39}$/.test(candidate) || candidate.startsWith("-") || candidate.endsWith("-")) {
    return null;
  }
  return candidate;
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
      throw new Error("GitHub profile was not found.");
    }
    if (response.status === 403) {
      throw new Error("GitHub rate limit or access policy blocked the request. Configure GITHUB_TOKEN for higher limits.");
    }
    throw new Error(`GitHub API returned ${response.status}.`);
  }
  return response.json() as Promise<T>;
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
  languages: Array<{ name: string; percent: number }>
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

  return {
    jobDescriptionProvided,
    matchingSkills,
    potentialGaps,
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

async function fetchRepoBundle(repo: GithubRepo): Promise<RepoBundle> {
  const [readmeText, commits, contents] = await Promise.all([
    fetchReadme(repo.full_name).catch(() => ""),
    githubFetch<Array<{ commit?: { message?: string } }>>(
      `https://api.github.com/repos/${repo.full_name}/commits?per_page=${COMMITS_PER_REPO}`
    ).catch(() => []),
    githubFetch<Array<{ name: string; type: string }>>(
      `https://api.github.com/repos/${repo.full_name}/contents`
    ).catch(() => []),
  ]);

  return {
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
  jobDescription: string
): Promise<CodeReviewPayload> {
  const reposReviewed = repos.map((repo) => repo.name);
  // Documented only for paths where the review actually assembles evidence; the
  // disabled / no-repos branches read nothing, so they advertise no basis.
  const evidenceBasis = describeEvidenceBasis();
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return {
      status: "disabled",
      summary: "Set GEMINI_API_KEY to enable Gemini-based repo-signal review.",
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

  let bundles: RepoBundle[];
  try {
    bundles = await Promise.all(repos.map(fetchRepoBundle));
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

  // fetchRepoBundle swallows each sub-fetch to a benign default ("" / []), so a
  // rate-limited or 5xx run yields bundles with no readme, commits, or files yet
  // Promise.all still "succeeds". If EVERY bundle is empty there is no signal to review —
  // sending it to Gemini would fabricate a confident, authoritative-looking assessment from
  // nothing. Fail loudly instead (almost always a transient rate limit, not empty repos).
  const hasAnySignal = bundles.some(
    (b) => b.readme.trim() || b.recentCommits.length > 0 || b.files.length > 0
  );
  if (!hasAnySignal) {
    return {
      status: "error",
      summary: "Couldn't gather any public repo signals (GitHub may be rate-limiting). Try again shortly.",
      confirmedSkills: [],
      unverifiedClaims: [],
      hiddenStrengths: [],
      reposReviewed,
      evidenceBasis,
      error: "insufficient_evidence: no readme/commits/files fetched across all repos",
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
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        temperature: 0.1,
        maxOutputTokens: 4000,
        responseMimeType: "application/json",
      },
    });
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
      summary: review.data.summary,
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
