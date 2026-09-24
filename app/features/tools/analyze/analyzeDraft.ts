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
// Text, the saved-JD link it came from (jdSlug/jdEdited), plus the two run-config
// flags (blind, reportLang) — and nothing else. File
// objects cannot be serialized, and a CV is candidate PII that must never reach
// browser storage, so attachments are NOT part of this draft: they survive a switch
// in module memory instead (analyzeAttachmentStore.ts) and end with a reload. The
// landed result is its own layer (analyzeSession.ts, which declares all four).

import { isLocale } from "@/i18n/locales";
import { JD_NONE, type JdSource } from "./analyzeJdSource";

export const ANALYZE_DRAFT_KEY = "kp.analyzeDraft";

export type AnalyzeDraft = {
  jd?: string;
  company?: string;
  github?: string;
  reportLang?: string;
  blind?: boolean;
  /** The saved JD `jd` came from (challenge-r10 analyze-workspace/A). Without it a
   *  sidebar hop brought a picked role back as plain text: no must/nice grounding,
   *  and a disabled Add-to-pipeline — learned only after paying for the run. Kept
   *  only beside a non-empty `jd` and only when it looks like a slug. */
  jdSlug?: string;
  /** The linked text differs from the saved body (kept only with `jdSlug`). */
  jdEdited?: boolean;
};

// A JD slug as the store mints it (letters, digits, dashes). Anything else under the
// key — a number, a path, whitespace — is not a link this draft will restore.
const JD_SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** Keep the link fields only when they are well-formed AND ride on real JD text. */
function keepJdLink(from: Record<string, unknown>, into: AnalyzeDraft): void {
  if (!into.jd || typeof from.jdSlug !== "string" || !JD_SLUG.test(from.jdSlug)) return;
  into.jdSlug = from.jdSlug;
  if (from.jdEdited === true) into.jdEdited = true;
}

/** The draft's text fields, in the order the restore applies them. */
export const ANALYZE_DRAFT_FIELDS = ["jd", "company", "github"] as const;
export type AnalyzeDraftField = (typeof ANALYZE_DRAFT_FIELDS)[number];

/**
 * Parse whatever is under the key into a draft, or null. Every field is checked
 * to be a string and non-string fields are DROPPED rather than the whole draft
 * refused — a corrupted `github` should not cost the recruiter their JD.
 * `reportLang` must pass `isLocale`; `blind` is kept only as a real boolean.
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
  if (isLocale(source.reportLang)) draft.reportLang = source.reportLang;
  if (typeof source.blind === "boolean") draft.blind = source.blind;
  keepJdLink(source, draft);
  return Object.keys(draft).length > 0 ? draft : null;
}

/**
 * What to persist for the current inputs — `null` means REMOVE the key. An
 * all-empty draft must not be written: leaving `{"jd":"","company":"",...}`
 * behind is how a reset would resurrect itself as a stale-looking entry, and an
 * empty string is not a draft. `blind: false` is the mount default and is
 * omitted; `reportLang` is kept only when `isLocale`.
 */
export function serializeAnalyzeDraft(draft: AnalyzeDraft): string | null {
  const kept: AnalyzeDraft = {};
  for (const field of ANALYZE_DRAFT_FIELDS) {
    const value = draft[field];
    if (typeof value === "string" && value !== "") kept[field] = value;
  }
  if (isLocale(draft.reportLang)) kept.reportLang = draft.reportLang;
  if (draft.blind === true) kept.blind = true;
  keepJdLink(draft, kept);
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

/** Restore reportLang only when it is still at the locale this mount started with. */
export function restoreDraftLocale(current: string, drafted: string | undefined, mountDefault: string): string {
  if (current !== mountDefault) return current;
  return drafted && isLocale(drafted) ? drafted : current;
}

/** Restore blind only when it is still at the mount default (false). */
export function restoreDraftBlind(current: boolean, drafted: boolean | undefined, mountDefault = false): boolean {
  if (current !== mountDefault) return current;
  return typeof drafted === "boolean" ? drafted : mountDefault;
}

/**
 * The JD column a draft restores to: a linked saved JD when the draft carries its
 * slug, typed text otherwise. A restored link is marked `restored` so the form
 * re-checks it against the library once that has loaded (reconcileRestoredLink).
 * An edited link has no stored baseline; Revert re-fetches the body instead.
 */
export function restoreJdSource(draft: AnalyzeDraft | null): JdSource {
  const text = draft?.jd;
  if (!text || !text.trim()) return JD_NONE;
  if (!draft.jdSlug) return { kind: "typed", text };
  const edited = draft.jdEdited === true;
  return { kind: "saved", slug: draft.jdSlug, text, baseline: edited ? null : text, state: "ready", edited, restored: true };
}
