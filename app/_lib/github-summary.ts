// Compact GitHub evidence summary attached to a pipeline entry (GH2).
//
// The full GithubAnalysis is a rich, tens-of-KB report; what the decision
// surfaces need is the decision-relevant core — who was assessed, which skills
// the public repo signals evidence vs which claims stay unverified, and where
// to look. This module is the single shape authority for that summary:
// `build` derives it from a validated GithubAnalysis (client side, at
// add-to-pipeline), `coerce` re-validates it field-by-field at the API
// boundary and at the DB read boundary (rowToEntry), so a hand-crafted POST
// or a corrupt column can never put an unbounded blob on the board payload.
//
// Pure + dependency-free on purpose (the schemas import is type-only, which
// the strip-only node --test runner erases) so it stays unit-testable — hence the
// URL scheme guard below is inlined rather than imported from safe-url.
import type { GithubAnalysis } from "./schemas";

export type GithubEvidenceSummary = {
  username: string;
  profileUrl: string;
  /** The deep-dive's one-paragraph read (capped). */
  summary: string;
  /** "Evidenced Skills" — what the public repo signals support (NOT inspected source). */
  confirmedSkills: string[];
  unverifiedClaims: string[];
  hiddenStrengths: string[];
  topRepositories: { name: string; url: string }[];
  analyzedAt: string;
};

const MAX_LIST_ITEMS = 12;
const MAX_REPOS = 3;
const MAX_ITEM_CHARS = 240;
const MAX_SUMMARY_CHARS = 600;

const clampStr = (value: string, max: number) => (value.length > max ? value.slice(0, max - 1) + "…" : value);

// profileUrl and each repo url are rendered as `<a href={...}>` in the recruiter
// drawer, so an attacker-supplied `javascript:`/`data:` value would be stored XSS
// in the recruiter console. Length-clamping is NOT sanitization — the scheme must be
// vetted. Drop anything that isn't a well-formed http(s) URL to an empty string (a
// blank href is inert). Mirrors safe-url.ts's safeHttpUrl guard, inlined to keep this
// module dependency-free (loadable by the strip-only test runner).
const _HTTP_SCHEMES = new Set(["http:", "https:"]);
const safeLinkUrl = (value: unknown): string => {
  if (typeof value !== "string") return "";
  try {
    const u = new URL(value);
    return _HTTP_SCHEMES.has(u.protocol) ? u.href : "";
  } catch {
    return ""; // relative/scheme-less/malformed
  }
};

function clampList(values: string[], max = MAX_LIST_ITEMS): string[] {
  return values.filter((v) => typeof v === "string" && v.trim().length > 0).slice(0, max).map((v) => clampStr(v, MAX_ITEM_CHARS));
}

export function buildGithubEvidenceSummary(a: GithubAnalysis): GithubEvidenceSummary {
  const review = a.codeReview;
  // ONLY the `ok` branch's summary is the model's own prose. Every other status
  // fills `summary` with canonical-English MACHINE copy the UI must not render
  // (schemas.ts, codeReview.summary) — "Set GEMINI_API_KEY (or add a Gemini key in
  // Models → Keys)…" on the keyless default, "Gemini returned a malformed
  // repo-signal review payload.", "Couldn't gather public repo signals…". This
  // summary is frozen onto the pipeline entry and rendered verbatim as a named
  // candidate's GitHub evidence (PipelineGithubEvidenceCard), so preferring it on a
  // non-ok review put an ops instruction on a person's record in place of the
  // metrics sentence that was sitting right there. Fall back to `a.summary`
  // whenever the review has no prose of its own — which is what the schema's
  // "when the deep review has none of its own" always meant.
  const reviewProse = review?.status === "ok" ? review.summary : "";
  return {
    username: clampStr(a.username, MAX_ITEM_CHARS),
    profileUrl: clampStr(safeLinkUrl(a.profileUrl), MAX_ITEM_CHARS),
    summary: clampStr((reviewProse || a.summary || "").trim(), MAX_SUMMARY_CHARS),
    confirmedSkills: clampList(review?.confirmedSkills ?? []),
    unverifiedClaims: clampList(review?.unverifiedClaims ?? []),
    hiddenStrengths: clampList(review?.hiddenStrengths ?? []),
    topRepositories: a.topRepositories.slice(0, MAX_REPOS).map((r) => ({
      name: clampStr(r.name, MAX_ITEM_CHARS),
      url: clampStr(safeLinkUrl(r.url), MAX_ITEM_CHARS),
    })),
    analyzedAt: clampStr(a.analyzedAt, MAX_ITEM_CHARS),
  };
}

/** Field-by-field boundary validation (repo convention: hand-rolled coercers,
 *  not zod, at API trust boundaries). Returns null when `raw` isn't
 *  summary-shaped; clamps every field so the output is bounded regardless of
 *  what was sent or stored. */
export function coerceGithubEvidenceSummary(raw: unknown): GithubEvidenceSummary | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.username !== "string" || !o.username.trim()) return null;
  if (typeof o.profileUrl !== "string") return null;
  const strList = (v: unknown): string[] =>
    Array.isArray(v) ? clampList(v.filter((x): x is string => typeof x === "string")) : [];
  const repos = Array.isArray(o.topRepositories)
    ? o.topRepositories
        .filter((r): r is { name: string; url: string } => {
          if (typeof r !== "object" || r === null) return false;
          const rec = r as Record<string, unknown>;
          return typeof rec.name === "string" && typeof rec.url === "string";
        })
        .slice(0, MAX_REPOS)
        .map((r) => ({ name: clampStr(r.name, MAX_ITEM_CHARS), url: clampStr(safeLinkUrl(r.url), MAX_ITEM_CHARS) }))
    : [];
  return {
    username: clampStr(o.username.trim(), MAX_ITEM_CHARS),
    profileUrl: clampStr(safeLinkUrl(o.profileUrl), MAX_ITEM_CHARS),
    summary: typeof o.summary === "string" ? clampStr(o.summary, MAX_SUMMARY_CHARS) : "",
    confirmedSkills: strList(o.confirmedSkills),
    unverifiedClaims: strList(o.unverifiedClaims),
    hiddenStrengths: strList(o.hiddenStrengths),
    topRepositories: repos,
    analyzedAt: typeof o.analyzedAt === "string" ? clampStr(o.analyzedAt, MAX_ITEM_CHARS) : "",
  };
}
