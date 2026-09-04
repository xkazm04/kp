import { COMMITS_PER_REPO, FILES_PER_REPO, README_TRUNCATE } from "@/app/_lib/github-evidence";
import { isOffline } from "@/app/_lib/offline";
import { readTextWithLimit } from "@/app/_lib/request-body";

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
  | "JD_TOO_LONG" // the pasted job description exceeds the prompt budget
  | "RESPONSE_TOO_LARGE" // GitHub answered 200 with a body past the byte cap
  | "OFFLINE" // KP_OFFLINE — this deployment makes no outbound call
  | "ANALYSIS_FAILED"; // unclassified

// CANONICAL ENGLISH per code, produced ONCE and consumed by everyone
// (api-contracts.md §1.1, applied to this surface's own code namespace). The route
// used to answer with the THROWN error's `.message`, so an undici/Node internal
// string could reach a recruiter's screen and no catalogue entry could ever cover
// it. Every answer now names a code and takes its English from here — the log line
// and the API-consumer line — while the panel renders `results.github.errors.<CODE>`
// in the reader's language.
export const GITHUB_ERRORS: Record<GithubErrorCode, string> = {
  HANDLE_REQUIRED: "Enter a GitHub username or profile URL.",
  PROFILE_NOT_FOUND: "GitHub profile was not found.",
  RATE_LIMITED:
    "GitHub rate limit or access policy blocked the request. Configure GITHUB_TOKEN for higher limits.",
  API_ERROR: "GitHub returned an unexpected error.",
  BAD_SHAPE: "Unexpected GitHub response shape.",
  NOT_A_PERSON:
    "That handle is a GitHub organization, not a personal account. Enter an individual developer's username.",
  REQUEST_THROTTLED: "Too many requests.",
  JD_TOO_LONG: "The job description is too long for the GitHub deep dive.",
  RESPONSE_TOO_LARGE: "GitHub returned a response larger than this route will read.",
  OFFLINE: "This deployment runs offline (KP_OFFLINE); GitHub was not contacted.",
  ANALYSIS_FAILED: "The GitHub analysis failed.",
};

/** A GitHub analysis failure carrying its localizable code.
 *
 *  `retryAfterSec` rides along when the boundary told us WHEN to come back — a
 *  `Retry-After` header, or GitHub's `x-ratelimit-reset` epoch. Without it a
 *  throttle is an open-ended "try again shortly"; with it the panel can say
 *  "try again in N minutes", which is the difference between a user retrying
 *  usefully and a user retrying into the same wall three times. */
export class GithubAnalysisError extends Error {
  readonly code: GithubErrorCode;
  readonly retryAfterSec?: number;
  constructor(code: GithubErrorCode, message: string, retryAfterSec?: number) {
    super(message);
    this.name = "GithubAnalysisError";
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

// GitHub's throttle answers name their own reset in two shapes: RFC-7231
// `Retry-After` (delta-seconds, on a secondary-rate-limit 403/429) and
// `x-ratelimit-reset` (a UNIX epoch second, on the primary limiter). Read both,
// prefer whichever is present, and clamp: a negative/absent value is "no hint",
// and a header claiming a day is not a hint a UI should repeat.
const RETRY_AFTER_MAX_SEC = 3600;
export function retryAfterSecondsFrom(headers: Headers, nowMs = Date.now()): number | undefined {
  const raw = headers.get("retry-after");
  if (raw) {
    const delta = Number(raw.trim());
    if (Number.isFinite(delta)) return clampRetryAfter(delta);
    // The header also permits an HTTP-date; Date.parse returns NaN on garbage.
    const at = Date.parse(raw);
    if (Number.isFinite(at)) return clampRetryAfter((at - nowMs) / 1000);
  }
  const reset = Number(headers.get("x-ratelimit-reset") ?? "");
  if (Number.isFinite(reset) && reset > 0) return clampRetryAfter(reset - nowMs / 1000);
  return undefined;
}

function clampRetryAfter(seconds: number): number | undefined {
  const rounded = Math.ceil(seconds);
  if (!Number.isFinite(rounded) || rounded <= 0) return undefined;
  return Math.min(rounded, RETRY_AFTER_MAX_SEC);
}

// A GitHub fetch failure that also carries the HTTP status, so a caller can tell a
// genuine 404 (the resource is absent — e.g. a repo with no README → real "no
// evidence") apart from a 403/429/5xx throttle (we couldn't read it → "could not
// determine"). FINDING #2 depends on this distinction so normal absences aren't
// mistaken for incomplete coverage, and throttles aren't mistaken for absence.
export class GithubHttpError extends GithubAnalysisError {
  readonly status: number;
  constructor(status: number, code: GithubErrorCode, message: string, retryAfterSec?: number) {
    super(code, message, retryAfterSec);
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

// Every call here is outbound I/O to a third party, and ONE run makes up to ~31 of
// them (3 sequential repo pages, then two fan-outs). Nothing else bounds them:
// `maxDuration` is serverless-only — self-hosted `next start` never kills a long
// handler (see .claude/CLAUDE.md) — and undici's default header/body timeout is 300s,
// so a single stalled connection could hold a recruiter's analysis for minutes and the
// three page reads are sequential. Bound each call the way the app's other outbound
// clients do (agent-hire/bridge-client, ats-egress: `AbortSignal.timeout`). A timeout
// is NOT a 404, so isCoverageLossError classifies it as a coverage loss and the
// language / bundle fan-outs degrade to "could not determine" rather than to "no
// evidence" — the honest reading of a call we never got an answer to.
const GITHUB_FETCH_TIMEOUT_MS = 20_000;

// A 200 body is as unbounded as a request body off the network: `response.json()`
// buffers whatever api.github.com sends (or whatever a hijacked/proxied endpoint
// sends), and one run makes up to ~31 of these reads inside a single handler. Cap
// the bytes actually read off the wire with the SAME reader the request side uses
// (readTextWithLimit's `BoundedBodySource` is structural exactly so the outbound
// side can reuse it). 4 MB is well past the largest legitimate answer here — a
// 100-repo page runs ~200 KB — so the cap only ever fires on an anomaly.
const GITHUB_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;

export async function githubFetch<T>(url: string): Promise<T> {
  // KP_OFFLINE — an air-gapped install makes no outbound call (self-hosting.md §7).
  // The global fetch guard in instrumentation.ts already blocks this egress, but it
  // does so by REJECTING the fetch, which reaches the route as an unclassified
  // ANALYSIS_FAILED carrying a guard's internal message. Consulting the predicate
  // here turns "we deliberately do not call GitHub" into its own coded answer,
  // BEFORE a socket is opened.
  if (isOffline()) {
    throw new GithubAnalysisError("OFFLINE", GITHUB_ERRORS.OFFLINE);
  }
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "kp-jobfit-github-analysis"
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  try {
    const response = await fetch(url, {
      headers,
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS)
    });
    if (!response.ok) {
      if (response.status === 404) {
        throw new GithubHttpError(404, "PROFILE_NOT_FOUND", GITHUB_ERRORS.PROFILE_NOT_FOUND);
      }
      // 403 is GitHub's primary limiter / an access policy; 429 is the secondary
      // one. Both are the same answer to a caller — come back later — and both name
      // WHEN in a header we used to drop on the floor.
      if (response.status === 403 || response.status === 429) {
        throw new GithubHttpError(
          response.status,
          "RATE_LIMITED",
          GITHUB_ERRORS.RATE_LIMITED,
          retryAfterSecondsFrom(response.headers)
        );
      }
      throw new GithubHttpError(
        response.status,
        "API_ERROR",
        `${GITHUB_ERRORS.API_ERROR} (HTTP ${response.status})`,
        retryAfterSecondsFrom(response.headers)
      );
    }
    // Awaited inside the try on purpose: the signal aborts a stalled BODY too, so the
    // abort can surface from the body read, not only from fetch(). Read through the
    // byte-capped reader rather than response.json() — see GITHUB_RESPONSE_MAX_BYTES.
    const text = await readTextWithLimit(response, GITHUB_RESPONSE_MAX_BYTES);
    if (text === null) {
      throw new GithubAnalysisError("RESPONSE_TOO_LARGE", GITHUB_ERRORS.RESPONSE_TOO_LARGE);
    }
    if (!text) return null as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      // A 200 whose body is not JSON at all is the same class of surprise as a 200
      // whose body is the wrong shape — the caller's BAD_SHAPE branch, not a raw
      // SyntaxError reaching the route as ANALYSIS_FAILED.
      throw new GithubAnalysisError("BAD_SHAPE", GITHUB_ERRORS.BAD_SHAPE);
    }
  } catch (error) {
    if (error instanceof GithubAnalysisError) throw error; // already classified above
    // The abort carries no HTTP status, so it would otherwise reach the route as an
    // unclassified ANALYSIS_FAILED with a raw "operation was aborted" string. Give it
    // the route's own localizable code instead.
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new GithubAnalysisError("API_ERROR", `${GITHUB_ERRORS.API_ERROR} (no response within ${GITHUB_FETCH_TIMEOUT_MS / 1000}s)`);
    }
    throw error;
  }
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
