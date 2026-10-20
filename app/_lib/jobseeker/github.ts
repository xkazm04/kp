// A job seeker's OWN GitHub account, read as a SECONDARY source of skill evidence and as
// the candidates for a Portfolio section of their designed CV. This module is the read;
// the derivation (repository labels -> skills -> evidence items) is
// pipeline/jobfit/github_evidence_cli.py, and the routes, storage, UI and the merge into
// matching and the CV consume both.
//
// Registry standard: recruiting/public-work-evidence-bounding. What it asks of THIS read:
//
//   IDENTITY IS A GATE. /users/{login} resolves organizations and bots too (one handle
//   grammar for all three), so only `type === "User"` is read. Anything else answers
//   `not_a_person`, its own state: an organization's portfolio is never attributed to
//   one person. The seeker's "this is me" confirmation belongs to the UI.
//   ATTRIBUTION. Only repositories the account OWNS (`type=owner`, and every row's
//   `owner.login` re-checked) that are NOT forks, because a fork's substance is
//   upstream's. A row marked private is dropped as well: the endpoint lists public work,
//   and a CV must never be where a private repository's name leaks.
//   DEPTH. Labels only: name, description, primary language, per-repo language BYTES,
//   topics, dates, stars, size. Never code, a README or a commit. `budget` names what
//   was read, as keys the artifact renders in its own words.
//   UNAVAILABLE IS NOT ABSENT. Throttled / offline / unreachable is a state, never an
//   empty snapshot. An account with no public repositories IS `ok` with `repos: []`,
//   because that was read. The per-repo language reads are the one partial read that is
//   kept: a throttle there stops them, keeps what was read, and `languageReads` says so.
//
// Cost: 1 + up to 3 + up to 12 requests, in series. GitHub's secondary rate limits
// punish concurrent bursts, and anonymously the whole budget is 60 requests an hour.
// Every request goes through the injectable `read` (default: repo-snapshot's
// githubRead, which never throws and refuses under KP_OFFLINE before any socket), so the
// tests use no network.

import { parseGithubUsername } from "@/app/_lib/github-handle";
import type { GithubRepo, GithubUser } from "@/app/_lib/github/client";
import { ACTIVE_WINDOW_MONTHS, RECENT_WINDOW_MONTHS, isWithinMonths } from "@/app/_lib/repo-activity";
import { githubRead, type GithubReadOutcome } from "@/app/_lib/repo-snapshot";

export type SeekerRepo = {
  name: string;
  fullName: string;
  htmlUrl: string;
  description: string | null;
  language: string | null;
  /** Bytes per language; null = not read (only the most recent repositories are). */
  languages: Record<string, number> | null;
  topics: string[];
  stars: number;
  pushedAt: string | null;
  createdAt: string | null;
  archived: boolean;
  sizeKb: number;
};

export type SeekerGithubSnapshot = {
  login: string;
  name: string | null;
  htmlUrl: string;
  publicRepos: number;
  /** ISO time the read began. portfolioCandidates measures recency from it. */
  readAt: string;
  /** Owned, non-fork, most recently pushed first, at most SEEKER_REPO_CAP. */
  repos: SeekerRepo[];
  /** The owner list was cut at the page cap (300 rows) with more to read and fewer than
   *  SEEKER_REPO_CAP owned non-forks collected. Stopping once the cap is held is not a
   *  cut: the rows are listed most recently pushed first, so every later page is older. */
  truncated: boolean;
  /** Per-repo /languages reads. Partial when read < planned. */
  languageReads: { planned: number; read: number };
  /** What was read, for the artifact's own words. `fields` are SeekerRepo keys, from
   *  SEEKER_GITHUB_FIELDS; "languages" is listed only when at least one read landed. */
  budget: { repos: number; fields: string[] };
};

export const SEEKER_GITHUB_FAILURE_STATES = [
  "invalid_handle",
  "not_found",
  "not_a_person",
  "throttled",
  "offline",
  "unreachable",
  "failed",
] as const;
export type SeekerGithubFailureState = (typeof SEEKER_GITHUB_FAILURE_STATES)[number];

export type SeekerGithubRead =
  | { ok: true; snapshot: SeekerGithubSnapshot }
  | { ok: false; state: SeekerGithubFailureState; retryAfterSec?: number };

/** The label fields a snapshot can say it read, in the order an artifact lists them. */
export const SEEKER_GITHUB_FIELDS = [
  "name",
  "description",
  "language",
  "languages",
  "topics",
  "stars",
  "pushedAt",
  "createdAt",
  "archived",
  "sizeKb",
] as const;
export type SeekerGithubField = (typeof SEEKER_GITHUB_FIELDS)[number];

/** The snapshot keeps the most recently pushed owned, non-fork repositories, this many. */
export const SEEKER_REPO_CAP = 60;
/** /languages is read for the most recently pushed non-archived repositories, this many. */
export const SEEKER_LANGUAGE_READ_CAP = 12;
/** A portfolio candidate was pushed within this many months of the read. */
export const PORTFOLIO_WINDOW_MONTHS = 24;

const GH = "https://api.github.com";
// GitHub's largest page for /users/{login}/repos, and the same 3-page (300 row) bound
// github/client.ts fetchOwnedRepoPages keeps on the recruiter side.
const REPO_PAGE_SIZE = 100;
const REPO_PAGE_CAP = 3;
// GitHub's own limits are 350 (description), 100 (name), 20 topics of 50 characters.
// Clamped anyway: this text is written into a CV and read by a model downstream.
const DESCRIPTION_MAX = 400;
const TOPICS_MAX = 20;
const TOPIC_MAX = 50;

/** The /users/{login} payload this read uses: GithubUser plus the display `name` it omits. */
type SeekerUserPayload = GithubUser & { name?: string | null };
/** A /users/{login}/repos row: GithubRepo plus what the REST payload also carries. */
type OwnedRepoPayload = GithubRepo & {
  archived?: boolean;
  created_at?: string | null;
  private?: boolean;
  owner?: { login?: string } | null;
};

type SeekerGithubFailure = Extract<SeekerGithubRead, { ok: false }>;
type ReadFailure = Extract<GithubReadOutcome<unknown>, { ok: false }>;
type SeekerGithubDeps = { read?: typeof githubRead; now?: () => Date };

export async function readSeekerGithub(handle: string, deps: SeekerGithubDeps = {}): Promise<SeekerGithubRead> {
  const read = deps.read ?? githubRead;
  const now = deps.now ?? (() => new Date());
  const requested = parseGithubUsername(handle);
  if (!requested) return { ok: false, state: "invalid_handle" };
  const readAt = now().toISOString();

  const userOut = await read<SeekerUserPayload>(`${GH}/users/${encodeURIComponent(requested)}`);
  if (!userOut.ok) return unavailable(userOut);
  const user = toSeekerUser(userOut.data);
  if (!user) return { ok: false, state: "failed" };
  if (user.type !== "User") return { ok: false, state: "not_a_person" };

  const listed = await readOwnedRepos(read, user.login, user.publicRepos);
  if (!listed.ok) return listed;
  const languageReads = await readLanguages(read, user.login, listed.repos);

  return {
    ok: true,
    snapshot: {
      login: user.login,
      name: user.name,
      htmlUrl: user.htmlUrl,
      publicRepos: user.publicRepos,
      readAt,
      repos: listed.repos,
      truncated: listed.truncated,
      languageReads,
      budget: {
        repos: listed.repos.length,
        fields: SEEKER_GITHUB_FIELDS.filter((field) => field !== "languages" || languageReads.read > 0),
      },
    },
  };
}

/**
 * The repositories worth offering for the CV's Portfolio section, best first. Substance
 * over popularity: not archived, described by its owner, pushed within
 * PORTFOLIO_WINDOW_MONTHS of the read, and not empty (sizeKb > 0).
 *
 * Ranked by recency, then size, with stars only breaking a tie. Recency is compared by
 * WINDOW (pushed within RECENT_WINDOW_MONTHS, within ACTIVE_WINDOW_MONTHS, within the
 * portfolio window; repo-activity.ts names the first two), not by timestamp: two pushes
 * are almost never at the same instant, so an exact comparison would leave size nothing
 * to decide and a one-line repository pushed this morning would outrank the substantial
 * one pushed last week.
 *
 * Pure: "now" is the snapshot's own readAt, so the same snapshot always answers the same
 * list, and a snapshot whose readAt is not a date answers none (recency cannot be judged).
 */
export function portfolioCandidates(snapshot: SeekerGithubSnapshot, n = 6): SeekerRepo[] {
  const limit = Math.floor(n);
  const anchor = Date.parse(snapshot.readAt);
  if (!(limit > 0) || !Number.isFinite(anchor)) return [];
  return snapshot.repos
    .filter(
      (repo) =>
        !repo.archived &&
        repo.sizeKb > 0 &&
        (repo.description ?? "").trim() !== "" &&
        isWithinMonths(repo.pushedAt, PORTFOLIO_WINDOW_MONTHS, anchor),
    )
    .map((repo) => ({ repo, window: recencyWindow(repo, anchor) }))
    .sort(
      (a, b) =>
        a.window - b.window ||
        b.repo.sizeKb - a.repo.sizeKb ||
        b.repo.stars - a.repo.stars ||
        byPushedDesc(a.repo, b.repo),
    )
    .slice(0, limit)
    .map(({ repo }) => repo);
}

// --- reads -------------------------------------------------------------------------------

async function readOwnedRepos(
  read: typeof githubRead,
  login: string,
  publicRepos: number,
): Promise<{ ok: true; repos: SeekerRepo[]; truncated: boolean } | SeekerGithubFailure> {
  const byFullName = new Map<string, SeekerRepo>();
  let rows = 0;
  let reachedEnd = false;
  for (let page = 1; page <= REPO_PAGE_CAP; page++) {
    const out = await read<OwnedRepoPayload[]>(
      `${GH}/users/${encodeURIComponent(login)}/repos?type=owner&sort=pushed&direction=desc&per_page=${REPO_PAGE_SIZE}&page=${page}`,
    );
    // Any page that cannot be read fails the read: the list is the spine of the evidence,
    // and a list with a hole in it would price as complete.
    if (!out.ok) return unavailable(out);
    // A 200 can carry an object (a secondary-rate-limit notice) instead of the list.
    if (!Array.isArray(out.data)) return { ok: false, state: "failed" };
    const pageRows: unknown[] = out.data;
    rows += pageRows.length;
    for (const row of pageRows) {
      const repo = toSeekerRepo(row, login);
      // A push between two page reads can shift a row onto the next page twice.
      const key = repo?.fullName.toLowerCase();
      if (repo && key && !byFullName.has(key)) byFullName.set(key, repo);
    }
    if (pageRows.length < REPO_PAGE_SIZE) {
      reachedEnd = true;
      break;
    }
    // Rows arrive most recently pushed first, so once the cap is held every later page
    // is older than all of it. Stop spending the caller's budget.
    if (byFullName.size >= SEEKER_REPO_CAP) break;
  }
  const repos = [...byFullName.values()].sort(byPushedDesc).slice(0, SEEKER_REPO_CAP);
  const truncated = !reachedEnd && byFullName.size < SEEKER_REPO_CAP && rows < publicRepos;
  return { ok: true, repos, truncated };
}

async function readLanguages(
  read: typeof githubRead,
  login: string,
  repos: SeekerRepo[],
): Promise<{ planned: number; read: number }> {
  const plan = repos.filter((repo) => !repo.archived).slice(0, SEEKER_LANGUAGE_READ_CAP);
  let done = 0;
  for (const repo of plan) {
    const out = await read<Record<string, number>>(
      `${GH}/repos/${encodeURIComponent(login)}/${encodeURIComponent(repo.name)}/languages`,
    );
    if (out.ok) {
      const bytes = toLanguageBytes(out.data);
      if (bytes) {
        repo.languages = bytes;
        done++;
      }
      continue;
    }
    // A throttle, an egress refusal or a dead network says the NEXT read fails the same
    // way: stop, keep what was read, and let `read < planned` say it. A per-repository
    // answer (a 404 after a rename, a 5xx, a bad body) leaves only that repository unread.
    if (out.kind === "throttled" || out.kind === "offline" || out.kind === "unreachable") break;
  }
  return { planned: plan.length, read: done };
}

function unavailable(out: ReadFailure): SeekerGithubFailure {
  const state: SeekerGithubFailureState =
    out.kind === "not_found"
      ? "not_found"
      : out.kind === "throttled"
        ? "throttled"
        : out.kind === "offline"
          ? "offline"
          : // A 5xx is GitHub failing to answer, the same "try again later" as a timeout.
            out.kind === "unreachable" || (out.kind === "http_error" && (out.status ?? 0) >= 500)
            ? "unreachable"
            : "failed";
  return out.retryAfterSec === undefined ? { ok: false, state } : { ok: false, state, retryAfterSec: out.retryAfterSec };
}

// --- payload coercion (field by field: the payload is untrusted until it is ours) --------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Whitespace-collapsed, clamped text; null when absent or blank. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed ? collapsed.slice(0, max) : null;
}

function isoDate(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

/** A github.com page URL, or null: this string becomes a link on a CV. */
function githubPage(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("https://github.com/") ? value : null;
}

function toSeekerUser(data: unknown): { login: string; type: string; name: string | null; htmlUrl: string; publicRepos: number } | null {
  if (!isRecord(data)) return null;
  // The login is spliced into every later URL, so it must pass the same grammar as input.
  const login = typeof data.login === "string" ? parseGithubUsername(data.login) : null;
  if (!login || typeof data.type !== "string" || !isCount(data.public_repos)) return null;
  return {
    login,
    type: data.type,
    name: text(data.name, 200),
    htmlUrl: githubPage(data.html_url) ?? `https://github.com/${login}`,
    publicRepos: data.public_repos,
  };
}

function toSeekerRepo(row: unknown, login: string): SeekerRepo | null {
  if (!isRecord(row)) return null;
  const name = text(row.name, 100);
  const fullName = text(row.full_name, 140);
  if (!name || !fullName) return null;
  // Attribution: a fork's substance is upstream's (a row that does not SAY it is not a
  // fork is not taken on trust), and a private row is never public work.
  if (row.fork !== false || row.private === true) return null;
  const owner = isRecord(row.owner) && typeof row.owner.login === "string" ? row.owner.login : fullName.split("/")[0];
  if (owner.toLowerCase() !== login.toLowerCase()) return null;
  return {
    name,
    fullName,
    htmlUrl: githubPage(row.html_url) ?? `https://github.com/${fullName}`,
    description: text(row.description, DESCRIPTION_MAX),
    language: text(row.language, 60),
    languages: null,
    topics: topicsOf(row.topics),
    stars: isCount(row.stargazers_count) ? row.stargazers_count : 0,
    pushedAt: isoDate(row.pushed_at),
    createdAt: isoDate(row.created_at),
    archived: row.archived === true,
    sizeKb: isCount(row.size) ? row.size : 0,
  };
}

function topicsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const topic = text(item, TOPIC_MAX);
    if (topic && !out.includes(topic)) out.push(topic);
    if (out.length >= TOPICS_MAX) break;
  }
  return out;
}

/** A /languages body, or null when it is not the documented {name: bytes} map. `{}` is a
 *  real answer (an empty repository), so it is read, with no languages. */
function toLanguageBytes(data: unknown): Record<string, number> | null {
  if (!isRecord(data)) return null;
  const entries: [string, number][] = [];
  for (const [language, bytes] of Object.entries(data)) {
    if (language.trim() && isCount(bytes) && bytes > 0) entries.push([language, bytes]);
  }
  // fromEntries defines own properties, so a hostile "__proto__" key stays a key.
  return Object.fromEntries(entries);
}

// --- ordering ----------------------------------------------------------------------------

function pushedMs(repo: SeekerRepo): number {
  const at = repo.pushedAt ? Date.parse(repo.pushedAt) : Number.NaN;
  return Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY;
}

/** Most recently pushed first; a repository never pushed goes last; then by name. */
function byPushedDesc(a: SeekerRepo, b: SeekerRepo): number {
  const pa = pushedMs(a);
  const pb = pushedMs(b);
  if (pa !== pb) return pb > pa ? 1 : -1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** 0 = pushed within RECENT_WINDOW_MONTHS, 1 = within ACTIVE_WINDOW_MONTHS, 2 = older. */
function recencyWindow(repo: SeekerRepo, anchor: number): number {
  if (isWithinMonths(repo.pushedAt, RECENT_WINDOW_MONTHS, anchor)) return 0;
  if (isWithinMonths(repo.pushedAt, ACTIVE_WINDOW_MONTHS, anchor)) return 1;
  return 2;
}
