// Pulls grounded reality from a GitHub repo for the Dev extension (Phase D2).
// Unreadable is not absent: a private fetch helper here once turned every failure into
// null, and a GitHub throttle then scored as "no commit history, no DECISIONS log".
// Every read now says read / not there (404) / could not read, and the last is carried
// forward as unread, never as empty. unionChangedPaths is mirrored inline below
// (devcase-seed-diff owns the tested copy).
import { isOffline } from "@/app/_lib/offline";
import { readTextWithLimit } from "@/app/_lib/request-body";

/** The parts of a RepoSnapshot that are read from GitHub, by name. */
export type RepoSnapshotPart = "languages" | "commits" | "contents" | "readme";

// ── The ONE GitHub transport ──
// Every api.github.com read goes through `githubRead`, the recruiter deep-dive's
// throwing `githubFetch` (github/client.ts) included. It lives in this leaf so the
// dev-case routes do not import the analyzer's client. It never throws.
export type GithubReadFailureKind =
  | "not_found" // 404
  | "throttled" // 403 / 429
  | "http_error" // other non-ok; `status` says which
  | "unreachable" // timeout, abort, network
  | "too_large" // 200 past the byte cap
  | "bad_shape" // 200, not JSON
  | "offline"; // KP_OFFLINE

export type GithubReadOutcome<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      kind: GithubReadFailureKind;
      status?: number;
      retryAfterSec?: number;
      cause?: unknown; // unreachable: the throw, for githubFetch to rethrow
    };

// `next start` never kills a long handler; a timeout is "could not read", not a 404.
export const GITHUB_FETCH_TIMEOUT_MS = 20_000;
// A 200 body is unbounded; 4 MB is far past any legitimate answer (~200 KB).
const GITHUB_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;

// `Retry-After` (seconds or HTTP-date) or `x-ratelimit-reset` (epoch s), clamped to 1 h.
const RETRY_AFTER_MAX_SEC = 3600;
export function retryAfterSecondsFrom(headers: Headers, nowMs = Date.now()): number | undefined {
  const raw = headers.get("retry-after");
  if (raw) {
    const delta = Number(raw.trim());
    if (Number.isFinite(delta)) return clampRetryAfter(delta);
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

export async function githubRead<T>(url: string): Promise<GithubReadOutcome<T>> {
  if (isOffline()) return { ok: false, kind: "offline" };
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "kp-jobfit-github-analysis",
  };
  // One credential rule for every GitHub read (the two transports used to disagree).
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const response = await fetch(url, {
      headers,
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      if (response.status === 404) return { ok: false, kind: "not_found", status: 404 };
      const kind: GithubReadFailureKind = response.status === 403 || response.status === 429 ? "throttled" : "http_error";
      const retryAfterSec = retryAfterSecondsFrom(response.headers);
      return retryAfterSec === undefined
        ? { ok: false, kind, status: response.status }
        : { ok: false, kind, status: response.status, retryAfterSec };
    }
    // Inside the try: the signal aborts a stalled BODY too.
    const text = await readTextWithLimit(response, GITHUB_RESPONSE_MAX_BYTES);
    if (text === null) return { ok: false, kind: "too_large", status: response.status };
    if (!text) return { ok: true, data: null as T };
    try {
      return { ok: true, data: JSON.parse(text) as T };
    } catch {
      return { ok: false, kind: "bad_shape", status: response.status };
    }
  } catch (error) {
    return { ok: false, kind: "unreachable", cause: error };
  }
}

export type RepoSnapshot = {
  ref: string;
  languages: Record<string, number>; // name -> share 0..1
  inferredStack: string[]; // derived from `languages`
  // RESERVED — always [] by design (idea-e3a2ec25). Framework detection is deliberately NOT done
  // deterministically here: consistent with this module's "collect durable raw signals, let the
  // model interpret them" principle (see `fetchRepoSignals` below and reflect.py), we hand the
  // languages / top-level names / README to the LLM and let IT name frameworks with its own
  // current knowledge, rather than bake a brittle classifier that could mislabel a hiring signal.
  // The field is kept (not deleted) because the cross-language RepoSnapshot contract (the Python
  // pydantic model in pipeline/jobfit/devcase/models.py, which this JSON is validated against)
  // carries it. Treat an empty `frameworks` as a documented decision, not a missing feature.
  frameworks: string[];
  topDirs: string[];
  recentCommitSummaries: string[];
  loc: number;
  readmeExcerpt: string;
  // Parts GitHub could not be READ (a 404 is a read: no README is not listed), so an
  // empty languages map is never taken as the repo's truth. Python ignores the field.
  unreadable: RepoSnapshotPart[];
};

const GH = "https://api.github.com";

export function parseRepoRef(ref: string): { owner: string; repo: string } | null {
  const m =
    ref.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?].*)?$/i) ||
    ref.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!m) return null;
  const owner = m[1];
  const repo = m[2];
  // Enforce GitHub's name grammar so a crafted ref (e.g. "x/..", "x/%2e%2e") can't survive
  // URL normalization and redirect the token-authenticated fetch to a DIFFERENT api.github.com
  // endpoint (confused-deputy). Owner: alphanumerics + hyphen, ≤39 chars. Repo: adds dot/underscore,
  // ≤100 chars, but never the traversal segments "." / "..". Anything else → unresolvable (null).
  if (!/^[A-Za-z0-9-]{1,39}$/.test(owner)) return null;
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(repo) || repo === "." || repo === "..") return null;
  return { owner, repo };
}

function arrayOf<T>(out: GithubReadOutcome<T[]>): T[] | null {
  return out.ok && Array.isArray(out.data) ? out.data : null;
}

// Not read = a failure other than 404, or a 200 that is not the shape needed.
function unread(out: GithubReadOutcome<unknown>, wantArray: boolean): boolean {
  if (!out.ok) return out.kind !== "not_found";
  return wantArray && out.data != null && !Array.isArray(out.data);
}

// The commit "subject" = the first line of a commit message, length-clamped. The
// snapshot path and the signals path tune `max` differently (100 vs 140), but the
// extraction itself was hand-copied; single-source it.
function firstLine(message: string | undefined, max: number): string {
  return (message ?? "").split("\n")[0].slice(0, max);
}

export async function buildRepoSnapshot(ref: string): Promise<RepoSnapshot | null> {
  const parsed = parseRepoRef(ref);
  if (!parsed) return null;
  const full = `${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`;

  const [langsR, commitsR, contentsR, readmeR] = await Promise.all([
    githubRead<Record<string, number>>(`${GH}/repos/${full}/languages`),
    githubRead<Array<{ commit: { message: string } }>>(`${GH}/repos/${full}/commits?per_page=20`),
    githubRead<Array<{ name: string; type: string }>>(`${GH}/repos/${full}/contents`),
    githubRead<{ content?: string; encoding?: string }>(`${GH}/repos/${full}/readme`),
  ]);
  const langs = langsR.ok ? langsR.data : null;
  const commits = arrayOf(commitsR);
  const contents = arrayOf(contentsR);
  const readme = readmeR.ok ? readmeR.data : null;

  // couldn't reach the repo at all → ungrounded
  if (!langs && !commits && !contents && !readme) return null;

  const unreadable: RepoSnapshotPart[] = [];
  if (unread(langsR, false)) unreadable.push("languages");
  if (unread(commitsR, true)) unreadable.push("commits");
  if (unread(contentsR, true)) unreadable.push("contents");
  if (unread(readmeR, false)) unreadable.push("readme");

  const langBytes = langs ?? {};
  const total = Object.values(langBytes).reduce((a, b) => a + b, 0) || 1;
  const languages: Record<string, number> = {};
  for (const [k, v] of Object.entries(langBytes)) languages[k] = Math.round((v / total) * 100) / 100;
  const inferredStack = Object.entries(langBytes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);

  const recentCommitSummaries = (commits ?? [])
    .slice(0, 20)
    .map((c) => firstLine(c.commit?.message, 100))
    .filter(Boolean);
  const topDirs = (contents ?? []).filter((c) => c.type === "dir").map((c) => c.name).slice(0, 20);
  const loc = Math.round(total / 40); // bytes → rough LOC estimate

  let readmeExcerpt = "";
  if (readme?.content && readme.encoding === "base64") {
    try {
      readmeExcerpt = Buffer.from(readme.content, "base64").toString("utf-8").slice(0, 800);
    } catch {
      /* ignore */
    }
  }

  // frameworks: [] by design — see the RESERVED note on RepoSnapshot.frameworks above.
  return { ref, languages, inferredStack, frameworks: [], topDirs, recentCommitSummaries, loc, readmeExcerpt, unreadable };
}

export type CommitEntry = { sha: string; message: string; date: string; additions?: number; deletions?: number; files?: number };

// One commits-API row → a base CommitEntry (7-char sha, subject, author date).
// Single-sources the slice constants the signals path otherwise hand-rolls.
function toCommitEntry(c: { sha?: string; commit?: { message?: string; author?: { date?: string } } }): CommitEntry {
  return {
    sha: (c.sha ?? "").slice(0, 7),
    message: firstLine(c.commit?.message, 140),
    date: c.commit?.author?.date ?? "",
  };
}

// Durable repo SIGNALS — facts whose meaning does not change as tooling trends churn:
// commit change-sizes + cadence, and the top-level tree (names only). We deliberately do
// NOT classify files here (tests / CI / agent configs); the model interprets the tree with
// its own current knowledge, so this never needs recalibration when a new tool appears.
export type RepoSignals = {
  ok: true;
  ref: string;
  commits: CommitEntry[];
  // cadence describes the rhythm of the history. `bursty` flags a repo whose whole history
  // landed in a single short sitting — a real cluster of commits within a few hours, as opposed
  // to work spread across days/weeks — and feeds a durable "how they worked" submission signal
  // (NOT a quality verdict). See `summarizeCadence` for the exact, unit-correct rule; `bursty`
  // is `null` when there are too few dated commits (< 2) to judge.
  cadence: { count: number; spanHours: number | null; bursty: boolean | null };
  topLevel: { name: string; type: string }[];
  // c364a44d — the distinct files the submission changed across the inspected
  // commits (union of the commit-detail `files[].filename` we already fetch for
  // change sizes). Feeds the seed-anchored diff: which planted seam files did the
  // candidate actually touch. Bounded by statsDepth, like the change-size stats.
  changedPaths: string[];
  // false = /contents failed (not a 404): topLevel is [] because it was never SEEN,
  // so no "no DECISIONS log" may be concluded from it.
  topLevelReadable: boolean;
  // Commit-detail fan-out: all answered / some ("partial", changedPaths from those) / none.
  statsReadable: boolean | "partial";
};

// The commits list could not be READ (kp's condition); null = the ref does not resolve.
export type RepoSignalsUnreadable = {
  ok: false;
  unreadable: Exclude<GithubReadFailureKind, "not_found">;
  retryAfterSec?: number;
};

// A coded, retryable refusal: the repo was not read, so nothing was scored or saved.
export class RepoUnreadableError extends Error {
  readonly code = "REPO_UNREADABLE" as const;
  readonly retryable = true as const;
  readonly kind: RepoSignalsUnreadable["unreadable"];
  readonly retryAfterSec?: number;
  constructor(kind: RepoSignalsUnreadable["unreadable"], retryAfterSec?: number) {
    super(
      `The submission repository could not be read from GitHub (${kind}); nothing was evaluated or scored. Retry later` +
        (retryAfterSec ? ` (GitHub suggests ${retryAfterSec}s).` : "."),
    );
    this.name = "RepoUnreadableError";
    this.kind = kind;
    this.retryAfterSec = retryAfterSec;
  }
}

// "Bursty" = the history landed in one short working sitting. The rule is named and
// unit-correct: the old `spanHours <= Math.max(6, times.length)` compared a DURATION in hours
// against a COUNT of commits — a unit mismatch nobody could safely tune. We instead require a
// real cluster (≥ BURSTY_MIN_COMMITS dated commits) that spans no more than BURSTY_WINDOW_HOURS.
export const BURSTY_WINDOW_HOURS = 6; // commits clustered within ~one working sitting
export const BURSTY_MIN_COMMITS = 3; // need a genuine cluster, not just a pair an hour apart

// Pure, testable cadence summary over commit timestamps. `count` is every commit; `spanHours`
// and `bursty` use only commits with a parseable date, and are `null` when fewer than two of
// those exist (no span to measure). Boundaries are inclusive (exactly BURSTY_WINDOW_HOURS counts).
export function summarizeCadence(commits: Pick<CommitEntry, "date">[]): RepoSignals["cadence"] {
  const times = commits
    .map((c) => Date.parse(c.date))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  let spanHours: number | null = null;
  let bursty: boolean | null = null;
  if (times.length >= 2) {
    spanHours = Math.round(((times[times.length - 1] - times[0]) / 3_600_000) * 10) / 10;
    bursty = times.length >= BURSTY_MIN_COMMITS && spanHours <= BURSTY_WINDOW_HOURS;
  }
  return { count: commits.length, spanHours, bursty };
}

export async function fetchRepoSignals(
  ref: string,
  max = 60,
  statsDepth = 12,
): Promise<RepoSignals | RepoSignalsUnreadable | null> {
  const parsed = parseRepoRef(ref);
  if (!parsed) return null;
  const full = `${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`;

  const [listR, contentsR] = await Promise.all([
    githubRead<Array<{ sha: string; commit: { message: string; author?: { date?: string } } }>>(
      `${GH}/repos/${full}/commits?per_page=${Math.min(Math.max(max, 1), 100)}`,
    ),
    githubRead<Array<{ name: string; type: string }>>(`${GH}/repos/${full}/contents`),
  ]);
  if (!listR.ok) {
    // 404: the ref does not resolve. 409: GitHub's answer for an EMPTY repository (no
    // commits to list). Both are facts about the repo: null, as before.
    if (listR.kind === "not_found" || (listR.kind === "http_error" && listR.status === 409)) return null;
    // Anything else is a read that never happened. Say so; never hand back "no commits".
    const out: RepoSignalsUnreadable = { ok: false, unreadable: listR.kind };
    if (listR.retryAfterSec !== undefined) out.retryAfterSec = listR.retryAfterSec;
    return out;
  }
  const list = arrayOf(listR);
  if (!list) return { ok: false, unreadable: "bad_shape" };

  const commits: CommitEntry[] = list.map(toCommitEntry);

  // Change-size shape for the most recent commits (one extra call each → capped).
  const depth = Math.min(statsDepth, list.length);
  const stats = await Promise.all(
    list
      .slice(0, depth)
      .map((c) =>
        githubRead<{ stats?: { additions?: number; deletions?: number }; files?: { filename?: string }[] }>(
          `${GH}/repos/${full}/commits/${c.sha}`,
        ).then((out) => (out.ok && out.data && typeof out.data === "object" ? out.data : null)),
      ),
  );
  const answered = stats.filter((s) => s !== null).length;
  const statsReadable: RepoSignals["statsReadable"] = answered === depth ? true : answered === 0 ? false : "partial";
  stats.forEach((s, i) => {
    if (s?.stats) {
      commits[i].additions = s.stats.additions ?? 0;
      commits[i].deletions = s.stats.deletions ?? 0;
      commits[i].files = Array.isArray(s.files) ? s.files.length : undefined;
    }
  });
  // The set of files changed across the inspected commits (for the seed diff), from
  // the commits that answered. Inline union (mirrors devcase-seed-diff.unionChangedPaths).
  const changedSet = new Set<string>();
  for (const s of stats) {
    for (const f of Array.isArray(s?.files) ? s!.files! : []) {
      if (f?.filename) changedSet.add(f.filename.trim().replace(/\\/g, "/").replace(/^\.\//, ""));
    }
  }
  const changedPaths = [...changedSet];

  // A 404 on /contents is an empty repository: read, and genuinely empty. Any other
  // failure (or a body that is not the documented array) is a tree we never saw.
  const contents = arrayOf(contentsR);
  const topLevelReadable = contents !== null || (!contentsR.ok && contentsR.kind === "not_found");
  const topLevel = (contents ?? []).map((e) => ({ name: e.name, type: e.type })).slice(0, 60);

  return {
    ok: true,
    ref,
    commits,
    cadence: summarizeCadence(commits),
    topLevel,
    changedPaths,
    topLevelReadable,
    statsReadable,
  };
}
