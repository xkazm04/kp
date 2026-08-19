// Where the source lives. KP is AGPL-3.0 (LICENSE), and the AGPL is only worth
// anything to a user who can actually FIND the source — §13 in particular assumes
// a running instance points at it. So this is not just a marketing link: on a
// modified, network-facing deployment it is part of the licence obligation, which
// is why it is configurable per deploy rather than hardcoded to the upstream repo.
//
// Set NEXT_PUBLIC_SOURCE_REPO_URL to YOUR fork if you modify KP and run it as a
// service. NEXT_PUBLIC_ is the only prefix Next.js exposes to the client bundle,
// so the landing page, the footer and the in-app surfaces all read the same value.
const DEFAULT_REPO_URL = "https://github.com/xkazm04/kp";

export const SOURCE_REPO_URL = process.env.NEXT_PUBLIC_SOURCE_REPO_URL?.trim() || DEFAULT_REPO_URL;

/** The repository root — "get the source" / "star us on GitHub" destinations. */
export function sourceRepoHref(): string {
  return SOURCE_REPO_URL;
}

/** A path inside the repository (README, LICENSE, a docs page), joined safely
 *  whether or not the configured URL carries a trailing slash. Falls back to the
 *  repo root for a self-hosted mirror whose layout we can't assume. */
export function sourceRepoFileHref(path: string): string {
  const base = SOURCE_REPO_URL.replace(/\/+$/, "");
  return `${base}/blob/main/${path.replace(/^\/+/, "")}`;
}
