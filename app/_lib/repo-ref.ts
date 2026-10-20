// `parseRepoRef` on its own leaf (no imports), so a client module that only needs to
// read an owner out of a repo reference does not pull the GitHub transport
// (repo-snapshot.ts and what it imports) onto the workspace page's graph. repo-snapshot
// re-exports it; server code may keep importing it from there.

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
