// Single source for parsing/normalizing a GitHub username from a bare handle or a
// github.com profile URL. Used by the deep-dive route (/api/github-analysis) and
// the conversational-apply handle gate (coerceGithubHandle in apply-intake.ts) so
// the grammar can't drift — these previously kept two copies that disagreed on
// whether the URL protocol was required (the route demanded `https://`, the apply
// gate made it optional), so a handle accepted at apply was rejected by the
// deep-dive. Accepts a bare username (a leading "@" tolerated) or a github.com URL
// (protocol and "www." optional, trailing path/query ignored) and returns the
// NORMALIZED bare username, or null for anything invalid. The handle is spliced
// into `api.github.com/users/${username}`, so the strict grammar (1–39 chars of
// [A-Za-z0-9-], no leading/trailing hyphen) is security-relevant — field-by-field
// coercion at the trust boundary, never a cast. Pure and dependency-free so both
// the Next bundle and the bare `node --test` strip runner can load it.
export function parseGithubUsername(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  const urlMatch = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#]+)(?:[/?#].*)?$/i.exec(trimmed);
  const candidate = (urlMatch ? urlMatch[1] : trimmed).replace(/^@/, "");
  if (!/^[A-Za-z0-9-]{1,39}$/.test(candidate) || candidate.startsWith("-") || candidate.endsWith("-")) {
    return null;
  }
  return candidate;
}
