import { randomBytes } from "node:crypto";

// Single source for the app's random id / token format. The same handcrafted
// entropy expression used to be inlined across the stores (db.ts, tasks.ts,
// offers-store, schedule-store, templates-store) and the apply route; centralizing
// it keeps the id scheme one helper instead of N drift-prone copies (a wrong slice
// length or missing prefix could otherwise slip through review).
//
// Two helpers with DIFFERENT trust levels — keep them apart:
//  - randomId()    INTERNAL primary keys. Never a security boundary, so a fast
//                  non-crypto RNG is fine (and the time prefix is a feature).
//  - randomToken() PUBLIC unguessable links. The ONLY gate on pages exposing
//                  salary, candidate identity, and job details — so it MUST draw
//                  from a CSPRNG, never Math.random().

/** A prefixed, roughly time-ordered id: `${prefix}-<base36 time>-<6 base36 random>`
 *  (e.g. randomId("off") -> "off-l9x2k1-a8f3qz"). The random suffix only de-collides
 *  ids minted in the same millisecond; these are internal keys, never exposed as a
 *  secret, so Math.random() is intentional here and the Date.now() prefix keeps ids
 *  roughly sortable. For anything that gates access, use randomToken() instead. */
export function randomId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A cryptographically-strong opaque token: `${prefix}-<32 base64url chars>` minted
 *  from 24 CSPRNG bytes (~192 bits of entropy). Used for unguessable public links
 *  (offer / schedule / interview) that gate PII and an irreversible accept/decline
 *  with no other auth. MUST stay CSPRNG-backed — Math.random() is non-cryptographic
 *  and predictable, which would make these links guessable/enumerable. base64url
 *  keeps the token URL-safe so it drops straight into the `[token]` route segment. */
export function randomToken(prefix: string): string {
  return `${prefix}-${randomBytes(24).toString("base64url")}`;
}
