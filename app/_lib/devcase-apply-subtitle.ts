// Catalog key for the apply page's one-line instruction. Live-work (a
// materialized seed) and repo-link are different submit paths; a single
// "submit a repository link" sentence contradicts the surface the candidate
// is about to use.
export function applySubtitleKey(hasSeed: boolean): "subtitleLive" | "subtitleRepo" {
  return hasSeed ? "subtitleLive" : "subtitleRepo";
}
