/*
 * The report's tab taxonomy + its deep link, in one place.
 *
 * These three rules were inline in ResultPanel.tsx: the id list (a bare type
 * alias, so nothing could iterate it), the fallback for a selected tab that no
 * longer exists, and — nothing at all for linking. A recruiter who wanted a
 * colleague to look at the SALARY tab of a report could only send the report
 * and say "click Salary"; the panel held its active tab in a plain useState
 * that no URL could reach.
 *
 * Literal array + derived union + runtime guard, the house shape for a closed
 * vocabulary (app/features/shell/tabs.ts, app/_lib/i18n/locales.ts).
 */

/** Every tab the report can show, in visual order. Two are conditional at
 *  render (compare needs a renderable comparison, github a deep-dive payload),
 *  which is why the parser below takes the AVAILABLE list rather than trusting
 *  this one. */
export const RESULT_TAB_IDS = ["extraction", "compare", "jobFit", "salary", "interview", "github"] as const;

export type ResultTab = (typeof RESULT_TAB_IDS)[number];

/** Runtime guard for the union — the hash is user-supplied text. */
export function isResultTab(value: unknown): value is ResultTab {
  return typeof value === "string" && (RESULT_TAB_IDS as readonly string[]).includes(value);
}

/** Namespaced on purpose: `#salary` would collide with any in-page anchor (and
 *  with a browser's own fragment scroll); `#report-salary` is unmistakably ours. */
const HASH_PREFIX = "report-";

export function resultTabHash(id: ResultTab): string {
  return `#${HASH_PREFIX}${id}`;
}

/** The tab a URL fragment asks for, or null when it asks for nothing we can
 *  honour — a foreign anchor, an unknown id, or a tab THIS report does not have
 *  (a link to #report-compare landing on a single-CV analysis). Null means "use
 *  the default", never "render a blank panel". Accepts the fragment with or
 *  without its leading '#', since `location.hash` carries one and a stored or
 *  hand-typed value may not. */
export function parseResultTabHash(hash: string, available: readonly ResultTab[]): ResultTab | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.startsWith(HASH_PREFIX)) return null;
  const id = raw.slice(HASH_PREFIX.length);
  if (!isResultTab(id)) return null;
  return available.includes(id) ? id : null;
}

/** The tab to actually render. The panel instance survives across analyses (it
 *  is rendered without a key), so the held id can point at a tab that has since
 *  disappeared — run a multi-variant compare, then a single-CV analysis. Answers
 *  the first available tab in that case, and null only when there are none. */
export function resolveActiveTab<T extends string>(active: T, ids: readonly T[]): T | null {
  if (ids.includes(active)) return active;
  return ids[0] ?? null;
}
