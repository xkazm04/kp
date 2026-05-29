// Pulls grounded reality from a GitHub repo for the Dev extension (Phase D2).
// Mirrors the fetch layer used by /api/github-analysis. Unauthenticated works at a
// low rate; GITHUB_TOKEN (same env var as the analyzer) raises the limit.

export type RepoSnapshot = {
  ref: string;
  languages: Record<string, number>; // name -> share 0..1
  inferredStack: string[];
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
  return m ? { owner: m[1], repo: m[2] } : null;
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
  const full = `${parsed.owner}/${parsed.repo}`;

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
    .map((c) => c.commit.message.split("\n")[0].slice(0, 100))
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

  return { ref, languages, inferredStack, frameworks: [], topDirs, recentCommitSummaries, loc, readmeExcerpt };
}

export type CommitEntry = { sha: string; message: string; date: string };

// The git trace for a (submission) repo: chronological commit messages + dates.
// Returns null if the repo can't be reached.
export async function fetchCommitTrace(ref: string, max = 60): Promise<CommitEntry[] | null> {
  const parsed = parseRepoRef(ref);
  if (!parsed) return null;
  const full = `${parsed.owner}/${parsed.repo}`;
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
