// Pulls grounded reality from a GitHub repo for the Dev extension (Phase D2).
// Mirrors the fetch layer used by /api/github-analysis. Unauthenticated works at a
// low rate; GITHUB_TOKEN (same env var as the analyzer) raises the limit.

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
};

const GH = "https://api.github.com";

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/vnd.github+json" };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

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

async function gh<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: ghHeaders(), next: { revalidate: 0 } });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export async function buildRepoSnapshot(ref: string): Promise<RepoSnapshot | null> {
  const parsed = parseRepoRef(ref);
  if (!parsed) return null;
  const full = `${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`;

  const [langs, commits, contents, readme] = await Promise.all([
    gh<Record<string, number>>(`${GH}/repos/${full}/languages`),
    gh<Array<{ commit: { message: string } }>>(`${GH}/repos/${full}/commits?per_page=20`),
    gh<Array<{ name: string; type: string }>>(`${GH}/repos/${full}/contents`),
    gh<{ content?: string; encoding?: string }>(`${GH}/repos/${full}/readme`),
  ]);

  // couldn't reach the repo at all → ungrounded
  if (!langs && !commits && !contents && !readme) return null;

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
    .map((c) => (c.commit?.message ?? "").split("\n")[0].slice(0, 100))
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
  return { ref, languages, inferredStack, frameworks: [], topDirs, recentCommitSummaries, loc, readmeExcerpt };
}

export type CommitEntry = { sha: string; message: string; date: string; additions?: number; deletions?: number; files?: number };

// The git trace for a (submission) repo: chronological commit messages + dates.
// Returns null if the repo can't be reached.
export async function fetchCommitTrace(ref: string, max = 60): Promise<CommitEntry[] | null> {
  const parsed = parseRepoRef(ref);
  if (!parsed) return null;
  const full = `${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`;
  const commits = await gh<Array<{ sha: string; commit: { message: string; author?: { date?: string } } }>>(
    `${GH}/repos/${full}/commits?per_page=${Math.min(Math.max(max, 1), 100)}`
  );
  if (!commits) return null;
  return commits.map((c) => ({
    sha: (c.sha ?? "").slice(0, 7),
    message: (c.commit?.message ?? "").split("\n")[0].slice(0, 140),
    date: c.commit?.author?.date ?? "",
  }));
}

// Durable repo SIGNALS — facts whose meaning does not change as tooling trends churn:
// commit change-sizes + cadence, and the top-level tree (names only). We deliberately do
// NOT classify files here (tests / CI / agent configs); the model interprets the tree with
// its own current knowledge, so this never needs recalibration when a new tool appears.
export type RepoSignals = {
  ref: string;
  commits: CommitEntry[];
  // cadence describes the rhythm of the history. `bursty` flags a repo whose whole history
  // landed in a single short sitting — a real cluster of commits within a few hours, as opposed
  // to work spread across days/weeks — and feeds a durable "how they worked" submission signal
  // (NOT a quality verdict). See `summarizeCadence` for the exact, unit-correct rule; `bursty`
  // is `null` when there are too few dated commits (< 2) to judge.
  cadence: { count: number; spanHours: number | null; bursty: boolean | null };
  topLevel: { name: string; type: string }[];
};

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

export async function fetchRepoSignals(ref: string, max = 60, statsDepth = 12): Promise<RepoSignals | null> {
  const parsed = parseRepoRef(ref);
  if (!parsed) return null;
  const full = `${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`;

  const [list, contents] = await Promise.all([
    gh<Array<{ sha: string; commit: { message: string; author?: { date?: string } } }>>(`${GH}/repos/${full}/commits?per_page=${Math.min(Math.max(max, 1), 100)}`),
    gh<Array<{ name: string; type: string }>>(`${GH}/repos/${full}/contents`),
  ]);
  if (!list) return null;

  const commits: CommitEntry[] = list.map((c) => ({
    sha: (c.sha ?? "").slice(0, 7),
    message: (c.commit?.message ?? "").split("\n")[0].slice(0, 140),
    date: c.commit?.author?.date ?? "",
  }));

  // Change-size shape for the most recent commits (one extra call each → capped).
  const depth = Math.min(statsDepth, list.length);
  const stats = await Promise.all(
    list.slice(0, depth).map((c) => gh<{ stats?: { additions?: number; deletions?: number }; files?: unknown[] }>(`${GH}/repos/${full}/commits/${c.sha}`))
  );
  stats.forEach((s, i) => {
    if (s?.stats) {
      commits[i].additions = s.stats.additions ?? 0;
      commits[i].deletions = s.stats.deletions ?? 0;
      commits[i].files = Array.isArray(s.files) ? s.files.length : undefined;
    }
  });

  const topLevel = (contents ?? []).map((e) => ({ name: e.name, type: e.type })).slice(0, 60);

  return { ref, commits, cadence: summarizeCadence(commits), topLevel };
}
