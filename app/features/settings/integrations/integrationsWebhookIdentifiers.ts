// The MACHINE IDENTIFIERS the ATS write-back panel puts on screen — the literal
// strings an operator matches against their own system, not copy. Every one of
// them has an authority elsewhere in the repo, and every one of them used to be
// hand-copied into IntegrationsWebhookPanel.tsx / IntegrationsWebhookFields.tsx
// as a bare literal, with nothing tying the copy to the original.
//
// Two shapes, by whether the authority can reach the browser bundle:
//
//   • IMPORTABLE — `ATS_SCHEMA_VERSION` (app/_lib/ats-record.ts is pure and
//     dependency-free by design). The panel imports it, so there is nothing to
//     drift. Its own doc comment says "bump on any breaking change"; the copy
//     that used to sit in the panel would have kept telling every operator
//     `kp.ats.v1` after that bump, on the one line of the page whose entire job
//     is naming the payload contract.
//
//   • NOT IMPORTABLE — app/_lib/ats-webhook.ts pulls in node:crypto to sign the
//     payload, so a client component cannot import SUBSCRIBABLE_EVENTS or
//     SIGNATURE_HEADER from it. Those are restated here ONCE, and
//     integrationsCatalog.test.ts asserts set-equality against the real ones —
//     the same discipline that file already applies to the calendar callback
//     statuses, the OAuth scopes and the ATS provider list. This module is
//     plain .ts (no JSX) precisely so that test, which runs under `node --test`
//     with type-stripping and no JSX transform, can import it.
//
// The event ids are also the vocabulary `ats-config-store.ts` VALIDATES a save
// against (`unknown event "…"`), which is what makes an unguarded copy here the
// "reads fine, write gets rejected" failure rather than a cosmetic one.

/** Whether an event the operator can subscribe to actually leaves kp today.
 *
 *  `live`     — at least one `dispatchAtsEvent("<id>", …)` call site exists in the
 *               server tree, so a subscription can fire.
 *  `reserved` — the id is accepted by the save (it is in SUBSCRIBABLE_EVENTS) but
 *               nothing emits it yet: a subscription the operator can make and
 *               never receive.
 *
 *  integrationsCatalog.test.ts holds each row's status to the emit sites IN BOTH
 *  DIRECTIONS: a `live` row with no dispatch is a subscription that silently never
 *  fires, and a `reserved` row that IS dispatched is the same lie the other way
 *  round (the hired-only footnote this replaced was that, in four locales, from the
 *  day the other emit sites landed). */
export const SUBSCRIBABLE_EVENT_STATUSES = ["live", "reserved"] as const;
export type SubscribableEventStatus = (typeof SUBSCRIBABLE_EVENT_STATUSES)[number];

/** One subscribable event: its wire id, the catalog key naming it, and whether it
 *  fires today. */
export type SubscribableEventRow = { id: string; key: string; status: SubscribableEventStatus };

/** Mirrors `SUBSCRIBABLE_EVENTS` in app/_lib/ats-webhook.ts — pinned by
 *  integrationsCatalog.test.ts, in both directions; each row's `status` is pinned
 *  to the emit sites the same way. */
export const SUBSCRIBABLE_EVENT_ROWS: readonly SubscribableEventRow[] = [
  { id: "candidate.hired", key: "candidateHired", status: "live" },
  { id: "candidate.rejected", key: "candidateRejected", status: "live" },
  { id: "offer.accepted", key: "offerAccepted", status: "live" },
  { id: "offer.declined", key: "offerDeclined", status: "live" },
];

/** Display casing of `SIGNATURE_HEADER` from app/_lib/ats-webhook.ts. HTTP header
 *  names are case-insensitive, so the canonical form is lowercase on the wire and
 *  this is the readable form — the test compares them case-insensitively. */
export const SIGNATURE_HEADER_DISPLAY = "X-Kp-Signature";

/** The on-demand pull endpoint, as an operator would type it. The path resolves
 *  to app/api/ats/candidate/[id]/; the test walks the filesystem to prove it,
 *  so a renamed route cannot leave stale instructions on the settings page. */
export const PULL_ENDPOINT = "GET /api/ats/candidate/<entryId>";

/** Placeholder endpoint in the URL field. Deliberately a documentation domain
 *  (RFC 2606 `.example.com`) so a mis-copied placeholder cannot reach a real host. */
export const EXAMPLE_WEBHOOK_URL = "https://your-ats.example.com/hooks/kp";
