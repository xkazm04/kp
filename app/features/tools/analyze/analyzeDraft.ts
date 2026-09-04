// The Analyze form's typed-but-not-yet-run draft: what is stored, what is read
// back, and what is refused.
//
// The Workspace unmounts the Analyze tab on every sidebar switch, so without this
// a pasted 5,000-word JD is gone the moment the recruiter hops to Pipeline to
// check a name. The rules were inline in useAnalyzeForm's two effects and had no
// test, which mattered because sessionStorage is the one input here nobody
// controls: another tab, an older build, or a user with devtools can leave any
// JSON at all under the key, and a draft read as a non-string would be pushed
// straight into a controlled <textarea> — the white-screen shape this repo has
// already been bitten by once on the ?jd= deep link.
//
// Text only, deliberately: File objects cannot be serialized, so attachments must
// be re-added after a switch and the draft never pretends otherwise.

export const ANALYZE_DRAFT_KEY = "kp.analyzeDraft";

export type AnalyzeDraft = { jd?: string; company?: string; github?: string };

/** The draft's fields, in the order the restore applies them. */
export const ANALYZE_DRAFT_FIELDS = ["jd", "company", "github"] as const;
export type AnalyzeDraftField = (typeof ANALYZE_DRAFT_FIELDS)[number];

/**
 * Parse whatever is under the key into a draft, or null. Every field is checked
 * to be a string and non-string fields are DROPPED rather than the whole draft
 * refused — a corrupted `github` should not cost the recruiter their JD.
 */
export function parseAnalyzeDraft(raw: string | null | undefined): AnalyzeDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON at all (a half-written value, another app's key, a manual edit).
    // There is nothing to restore and nothing an operator would act on.
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const source = parsed as Record<string, unknown>;
  const draft: AnalyzeDraft = {};
  for (const field of ANALYZE_DRAFT_FIELDS) {
    const value = source[field];
    if (typeof value === "string" && value !== "") draft[field] = value;
  }
  return Object.keys(draft).length > 0 ? draft : null;
}

/**
 * What to persist for the current inputs — `null` means REMOVE the key. An
 * all-empty draft must not be written: leaving `{"jd":"","company":"",...}`
 * behind is how a reset would resurrect itself as a stale-looking entry, and an
 * empty string is not a draft.
 */
export function serializeAnalyzeDraft(draft: AnalyzeDraft): string | null {
  const kept: AnalyzeDraft = {};
  for (const field of ANALYZE_DRAFT_FIELDS) {
    const value = draft[field];
    if (typeof value === "string" && value !== "") kept[field] = value;
  }
  if (Object.keys(kept).length === 0) return null;
  return JSON.stringify(kept);
}

/**
 * The restore rule: a draft only fills a field that is still empty. A saved-JD
 * pick or a prop-seeded value from THIS mount is fresher than a stale draft and
 * always wins.
 */
export function restoreDraftValue(current: string, drafted: string | undefined): string {
  return current || drafted || "";
}
