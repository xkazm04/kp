/*
 * The spotlight vocabulary as data: the nine preview keys in grid order, the
 * walk between them, and the URL address a pinned spotlight lives at.
 *
 * Pure `.ts` (no JSX, no React) so node:test can pin it - see order.test.ts.
 * The literal-array + derived-union idiom the repo uses for every closed
 * vocabulary (`about-art/shared.ts` ABOUT_STEP_KEYS, `i18n/locales.ts`): the
 * order HERE is the order the grid renders (FeatureGrid maps over it) and the
 * order prev/next and ArrowLeft/ArrowRight walk in the pinned dialog.
 *
 * THE ADDRESS IS NOT AN ELEMENT ID. A pinned spotlight is `/#spotlight-<key>`,
 * deliberately a different namespace from the cards' internal
 * `feature-<key>-title` ids: the external address is a promise to whoever
 * pasted the link, the internal id is free to change with the markup. The hash
 * never reaches the server, and every write keeps the path and query as they
 * were (urlWithHash), so the canonical URL and the hreflang alternates the
 * server renders for `/` are untouched.
 */

export const PREVIEW_KEYS = [
  "score",
  "voice",
  "cases",
  "schedule",
  "inbox",
  "salary",
  "rediscover",
  "offer",
  "gates"
] as const;

export type PreviewKey = (typeof PREVIEW_KEYS)[number];

/** Membership by array lookup, never `in` on a record: `toString` and
 *  `__proto__` are not previews. */
export function isPreviewKey(value: string): value is PreviewKey {
  return (PREVIEW_KEYS as readonly string[]).includes(value);
}

/** The neighbour in grid order; the walk wraps at both ends. */
export function stepPreview(key: PreviewKey, dir: 1 | -1): PreviewKey {
  const n = PREVIEW_KEYS.length;
  const i = PREVIEW_KEYS.indexOf(key);
  return PREVIEW_KEYS[(((i + dir) % n) + n) % n];
}

/** 1-based position for the "3 of 9" line. */
export function previewPosition(key: PreviewKey): { n: number; total: number } {
  return { n: PREVIEW_KEYS.indexOf(key) + 1, total: PREVIEW_KEYS.length };
}

const SPOTLIGHT_PREFIX = "#spotlight-";

export function spotlightHash(key: PreviewKey): string {
  return `${SPOTLIGHT_PREFIX}${key}`;
}

/** `#spotlight-<key>` -> key; anything else (a band hash, an element id, a
 *  wrong-case or prototype key, empty) -> null. */
export function parseSpotlightHash(hash: string): PreviewKey | null {
  if (!hash.startsWith(SPOTLIGHT_PREFIX)) return null;
  const key = hash.slice(SPOTLIGHT_PREFIX.length);
  return isPreviewKey(key) ? key : null;
}

/** The hash to put back when the dialog closes: whatever was there before it
 *  opened, unless that was itself a spotlight address (a link that opened the
 *  dialog on load) - a closed dialog never leaves a dead #spotlight-* behind. */
export function hashAfterClose(prior: string | null): string {
  if (!prior || parseSpotlightHash(prior)) return "";
  return prior;
}

/** Path + query exactly as they were, with only the fragment swapped. An empty
 *  hash drops the fragment (`history.replaceState(null, "", "")` would not). */
export function urlWithHash(pathname: string, search: string, hash: string): string {
  return `${pathname}${search}${hash}`;
}

/**
 * Which way an arrow key walks the pinned spotlight, or null to leave the key
 * alone. Any modifier is left alone - Alt+ArrowLeft is the browser's Back - and
 * so is a key typed into a text field. useDialogA11y handles only Escape and
 * Tab, so the two do not compete for a key.
 */
export function arrowStep(
  e: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  target: { tagName: string; isContentEditable: boolean } | null
): 1 | -1 | null {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return null;
  if (e.key === "ArrowRight") return 1;
  if (e.key === "ArrowLeft") return -1;
  return null;
}
