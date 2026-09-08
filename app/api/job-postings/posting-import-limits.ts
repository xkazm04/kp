// Caps for the posting-import route. They live in a sibling module because a
// non-handler `export const` inside a route file aborts `next build` — the same
// reason app/api/intake/[id]/attachments/attachment-limits.ts exists.

/** The floor a pasted or fetched body must clear to be stored as a posting. Below
 *  this it is a navigation stub, a cookie banner or a JS-only page that rendered
 *  nothing — storing it would poison the corpus the intake studio grounds on. A real
 *  advertisement in this corpus is 700–8400 characters. */
export const POSTING_MIN_CHARS = 200;

/** Hard ceiling on a stored body: a careers page can carry an entire blog. */
export const POSTING_MAX_CHARS = 60_000;
