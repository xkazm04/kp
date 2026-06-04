// Single source for the app's random id / token format. The same handcrafted
// entropy expression used to be inlined across the stores (db.ts, tasks.ts,
// offers-store, schedule-store, templates-store) and the apply route; centralizing
// it keeps the id scheme one helper instead of N drift-prone copies (a wrong slice
// length or missing prefix could otherwise slip through review).

/** A prefixed, roughly time-ordered id: `${prefix}-<base36 time>-<6 base36 random>`
 *  (e.g. randomId("off") -> "off-l9x2k1-a8f3qz"). */
export function randomId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A higher-entropy opaque token: `${prefix}-<20 base36 random>` (two 10-char
 *  draws). Used for unguessable public links (offer / schedule / interview). */
export function randomToken(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
}
