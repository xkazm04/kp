import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { logGithub, newRequestId } from "@/app/_lib/logger";
import { githubAnalysisSchema } from "@/app/_lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 60;

const GEMINI_MODEL = "gemini-3-flash-preview";
const README_TRUNCATE = 3500;
const COMMITS_PER_REPO = 10;
const FILES_PER_REPO = 30;
const DEEP_REVIEW_REPO_LIMIT = 3;

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

  try {
    const user = await githubFetch<GithubUser>(`https://api.github.com/users/${encodeURIComponent(username)}`);
    const repos = await githubFetch<GithubRepo[]>(
      `https://api.github.com/users/${encodeURIComponent(username)}/repos?per_page=100&sort=updated&type=owner`
    );
    const ownedRepos = repos.filter((repo) => !repo.fork);
    const reposForLanguages = ownedRepos.slice(0, 20);
    const languageMaps = await Promise.all(
      reposForLanguages.map((repo) =>
        githubFetch<Record<string, number>>(`https://api.github.com/repos/${repo.full_name}/languages`).catch(() => ({}))
      )
    );

    const languageTotals = mergeLanguageMaps(languageMaps);
    const languageSummary = summarizeLanguages(languageTotals);
    const topRepositories = ownedRepos
      .sort((a, b) => repoRank(b) - repoRank(a))
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
    const activeRepos = ownedRepos.filter((repo) => isWithinMonths(repo.pushed_at ?? repo.updated_at, 12)).length;
    const recentlyUpdatedRepos = ownedRepos.filter((repo) => isWithinMonths(repo.updated_at, 3)).length;
    const contributionSignals = buildContributionSignals({
      ownedRepos,
      totalStars,
      totalForks,
      activeRepos,
      recentlyUpdatedRepos,
      languages: languageSummary
    });
    const jobFitSignals = buildJobFitSignals(jobDescription, ownedRepos, languageSummary);
    const reviewableRepos = ownedRepos
      .sort((a, b) => repoRank(b) - repoRank(a))
      .slice(0, DEEP_REVIEW_REPO_LIMIT);
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
  return repo.stargazers_count * 4 + repo.forks_count * 3 + repo.size / 500 + (isWithinMonths(repo.pushed_at ?? repo.updated_at, 12) ? 20 : 0);
}

function complexitySignals(repo: GithubRepo) {
  const signals: string[] = [];
  if (repo.size > 5000) signals.push("large codebase footprint");
  if (repo.stargazers_count >= 10) signals.push("external interest through stars");
  if (repo.forks_count >= 3) signals.push("forked by other developers");
  if ((repo.topics ?? []).some((topic) => /test|ci|docker|kubernetes|deploy|infra|automation/i.test(topic))) {
    signals.push("delivery or engineering-practice topic");
  }
  if (repo.open_issues_count > 0) signals.push("issue-tracked project");
  if (isWithinMonths(repo.pushed_at ?? repo.updated_at, 6)) signals.push("recently maintained");
  return signals.length ? signals : ["metadata-only signal"];
}

function isWithinMonths(dateText: string | null, months: number) {
  if (!dateText) return false;
  const date = new Date(dateText).getTime();
  const threshold = Date.now() - months * 30 * 24 * 60 * 60 * 1000;
  return Number.isFinite(date) && date >= threshold;
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
    `${input.activeRepos} repositories show activity in the last 12 months; ${input.recentlyUpdatedRepos} were updated in the last 3 months.`,
    `${input.totalStars} total stars and ${input.totalForks} total forks across owned repositories.`
  ];
  if (input.languages.length) {
    signals.push(`Dominant public language mix: ${input.languages.slice(0, 4).map((lang) => `${lang.name} ${lang.percent}%`).join(", ")}.`);
  }
  return signals;
}

function buildJobFitSignals(
  jobDescription: string,
  repos: GithubRepo[],
  languages: Array<{ name: string; percent: number }>
) {
  const haystack = [
    ...repos.flatMap((repo) => [repo.name, repo.description ?? "", repo.language ?? "", ...(repo.topics ?? [])]),
    ...languages.map((language) => language.name)
  ]
    .join(" ")
    .toLowerCase();
  const job = jobDescription.toLowerCase();
  const matchingSkills: string[] = [];
  const potentialGaps: string[] = [];

  for (const [skill, aliases] of Object.entries(SKILL_ALIASES)) {
    const jobMentions = aliases.some((alias) => job.includes(alias));
    const githubMentions = aliases.some((alias) => haystack.includes(alias));
    if (jobMentions && githubMentions) {
      matchingSkills.push(skill);
    } else if (jobMentions && !githubMentions) {
      potentialGaps.push(skill);
    }
  }

  const complexRepos = repos.filter((repo) => complexitySignals(repo).length > 1).length;
  const complexityAssessment =
    complexRepos >= 4
      ? "Public repositories show multiple complexity signals across maintained, non-trivial projects."
      : complexRepos >= 1
        ? "Public repositories show some complexity signals, but the LLM should inspect repo substance before treating them as production-grade evidence."
        : "Public metadata is thin; treat GitHub as weak supplemental evidence unless deeper repo review is performed.";

  return {
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

type CodeReviewPayload = {
  status: "disabled" | "ok" | "error";
  summary: string;
  confirmedSkills: string[];
  unverifiedClaims: string[];
  hiddenStrengths: string[];
  reposReviewed: string[];
  error: string | null;
};

async function runCodeReview(
  repos: GithubRepo[],
  jobDescription: string
): Promise<CodeReviewPayload> {
  const reposReviewed = repos.map((repo) => repo.name);
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return {
      status: "disabled",
      summary: "Set GEMINI_API_KEY to enable Gemini-based code-aware review.",
      confirmedSkills: [],
      unverifiedClaims: [],
      hiddenStrengths: [],
      reposReviewed,
      error: null,
    };
  }
  if (repos.length === 0) {
    return {
      status: "ok",
      summary: "No owned public repositories were available to review.",
      confirmedSkills: [],
      unverifiedClaims: [],
      hiddenStrengths: [],
      reposReviewed,
      error: null,
    };
  }

  let bundles: RepoBundle[];
  try {
    bundles = await Promise.all(repos.map(fetchRepoBundle));
  } catch (error) {
    return {
      status: "error",
      summary: "Failed to fetch repository contents for deep review.",
      confirmedSkills: [],
      unverifiedClaims: [],
      hiddenStrengths: [],
      reposReviewed,
      error: error instanceof Error ? error.message : String(error),
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
    "You are a precise senior engineer reviewing public GitHub artifacts for hiring evidence.",
    "Read the bundled repository data (READMEs, recent commit messages, root file listings, languages, topics).",
    "Decide which technical skills are demonstrably present in the code, which are *claimed* in the job description but absent from the public evidence, and which strengths the code shows that the job description didn't ask for.",
    "Output ONLY a JSON object matching this shape — no markdown fences, no commentary:",
    `{"summary": "2-3 sentence overall assessment.", "confirmed_skills": ["skill","skill"], "unverified_claims": ["jd skill not visible in code"], "hidden_strengths": ["skill in code but not in jd"]}`,
    "",
    "Job description (may be empty):",
    jobDescription || "(none supplied)",
    "",
    "Repository evidence:",
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
    const parsed = parseReviewJson(text);
    if (!parsed) {
      return {
        status: "error",
        summary: "Gemini returned a malformed code-review payload.",
        confirmedSkills: [],
        unverifiedClaims: [],
        hiddenStrengths: [],
        reposReviewed,
        error: "non-json response",
      };
    }
    return {
      status: "ok",
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      confirmedSkills: stringArray(parsed.confirmed_skills),
      unverifiedClaims: stringArray(parsed.unverified_claims),
      hiddenStrengths: stringArray(parsed.hidden_strengths),
      reposReviewed,
      error: null,
    };
  } catch (error) {
    return {
      status: "error",
      summary: "Gemini code-review request failed.",
      confirmedSkills: [],
      unverifiedClaims: [],
      hiddenStrengths: [],
      reposReviewed,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseReviewJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}
