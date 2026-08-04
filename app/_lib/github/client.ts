import { COMMITS_PER_REPO, FILES_PER_REPO, README_TRUNCATE } from "@/app/_lib/github-evidence";

// The GitHub REST layer behind /api/github-analysis: the typed account/repo
// shapes, the one authenticated fetch helper, the paginated owned-repo read, and
// the per-repo "signal bundle" the deep review is built from. Everything here
// talks to api.github.com and nothing here interprets the data — the ranking,
// skill and review heuristics live in their own sibling modules.

export type GithubUser = {
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

export type GithubRepo = {
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

// Why a GitHub analysis failed, as a stable machine code. The route answers with
// `{ error, code }` (the app-wide contract — docs/architecture/localization.md):
// `error` is canonical English for the server log and API consumers, `code` is
// what the UI resolves, in the reader's language, through
// `results.github.errors.<CODE>`. Every throw below therefore carries one.
export type GithubErrorCode =
  | "HANDLE_REQUIRED" // no parseable username in the request
  | "PROFILE_NOT_FOUND" // GitHub 404
  | "RATE_LIMITED" // GitHub 403 — their limiter or an access policy
  | "API_ERROR" // any other non-ok GitHub status
  | "BAD_SHAPE" // a 200 whose body isn't the documented array
  | "NOT_A_PERSON" // the handle resolves to an organization
  | "REQUEST_THROTTLED" // OUR per-IP limiter, not GitHub's
  | "ANALYSIS_FAILED"; // unclassified

/** A GitHub analysis failure carrying its localizable code. */
export class GithubAnalysisError extends Error {
  readonly code: GithubErrorCode;
  constructor(code: GithubErrorCode, message: string) {
    super(message);
    this.name = "GithubAnalysisError";
    this.code = code;
  }
}

// A GitHub fetch failure that also carries the HTTP status, so a caller can tell a
// genuine 404 (the resource is absent — e.g. a repo with no README → real "no
// evidence") apart from a 403/429/5xx throttle (we couldn't read it → "could not
// determine"). FINDING #2 depends on this distinction so normal absences aren't
// mistaken for incomplete coverage, and throttles aren't mistaken for absence.
export class GithubHttpError extends GithubAnalysisError {
  readonly status: number;
  constructor(status: number, code: GithubErrorCode, message: string) {
    super(code, message);
    this.name = "GithubHttpError";
    this.status = status;
  }
}

// True when an error means "we couldn't read this", not "it isn't there". A 404 is
// a definitive absence; everything else — a 403/429 secondary-rate-limit, a 5xx, or
// a network throw with no status — is a coverage loss the caller must treat as
// "could not determine" rather than as empty evidence.
export function isCoverageLossError(error: unknown): boolean {
  return !(error instanceof GithubHttpError && error.status === 404);
}

export async function githubFetch<T>(url: string): Promise<T> {
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
      throw new GithubHttpError(404, "PROFILE_NOT_FOUND", "GitHub profile was not found.");
    }
    if (response.status === 403) {
      throw new GithubHttpError(
        403,
        "RATE_LIMITED",
        "GitHub rate limit or access policy blocked the request. Configure GITHUB_TOKEN for higher limits."
      );
    }
    throw new GithubHttpError(response.status, "API_ERROR", `GitHub API returned ${response.status}.`);
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
export async function fetchOwnedRepoPages(
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
      throw new GithubAnalysisError("BAD_SHAPE", "Unexpected GitHub response shape (expected a repository array).");
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

export type RepoBundle = {
  name: string;
  language: string | null;
  topics: string[];
  description: string | null;
  readme: string;
  recentCommits: string[];
  files: string[];
};

export async function fetchRepoBundle(repo: GithubRepo): Promise<{ bundle: RepoBundle; incomplete: boolean }> {
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
