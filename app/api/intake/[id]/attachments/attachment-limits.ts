// Caps for the intake attachments route — the trust boundary for free-typed
// content: ≤5 attachments per session, note/JD text ≤20k chars.
//
// These live in a sibling module rather than in `route.ts` because Next's generated
// route types reject any non-handler `export const` in a route module (`Type '5' is
// not assignable to type 'never'`), which aborts `next build` after compile and stops
// `.next/standalone` from ever being emitted. See backlog item 57.

export const ATTACHMENT_LIMIT = 5;
export const ATTACHMENT_TEXT_MAX = 20_000;
