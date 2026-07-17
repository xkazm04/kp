# ATS Integration & Egress — ambiguity-guardian + ui-perfectionist scan

> Total: 6 findings (0 critical, 1 high, 4 medium, 1 low)

## 1. candidate.hired can ship the WRONG offer's comp — fallback picks the oldest offer, not the accepted one
- **Severity**: High
- **Lens**: ambiguity
- **Category**: stale-offer-selection
- **File**: `app/_lib/ats-egress.ts:32`
- **Scenario**: A candidate had an offer that was declined (or expired), then a second offer was extended and accepted. `candidate.hired` fires from offer-finalize and the receiving ATS lands an offer block with the FIRST offer's salary/currency and status `declined` — not the accepted offer that caused the hire.
- **Root cause**: `getOpenOfferForEntry(entryId) ?? listOffersForEntry(entryId)[0]` — at hired-dispatch time the accepted offer's status is no longer `extended`, so `getOpenOfferForEntry` (which filters `status = 'extended'`, offers-store.ts:276) returns null, and the fallback `listOffersForEntry` orders `created_at ASC` (offers-store.ts:268), so `[0]` is the OLDEST offer for the entry, whatever its state. The offers-store even documents a re-extend flow ("dedupe re-extends"), so multi-offer entries are a supported path, not a corner case.
- **Impact**: The system of record ingests wrong compensation and a contradictory offer status (`declined` inside a `candidate.hired` event) — exactly the class of silent data corruption a versioned record was built to prevent. Retries rebuild from current state, so the wrong offer is re-sent, not healed.
- **Fix sketch**: Make offer selection explicit and terminal-state-aware: prefer the most recent `accepted` offer, then the open one, then the most recent by `created_at DESC` (e.g. `listOffersForEntry(entryId).at(-1)` or a dedicated `getLatestOfferForEntry`). Add a comment stating which offer the record is contractually supposed to carry per event type.

## 2. Three of the four subscribable events never fire — the UI sells subscriptions the backend doesn't emit
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: dead-event-subscriptions
- **File**: `app/_lib/ats-webhook.ts:14-24` (contract), `app/features/tasks/IntegrationsCard.tsx:150-156` (checkboxes), `app/_lib/offer-finalize.ts:136` (decline path dispatches nothing)
- **Scenario**: An integrator checks `offer.declined` (or `candidate.rejected`, `offer.accepted`), saves, sends a successful test ping, and waits. Candidates decline offers; nothing ever arrives. The only `dispatchAtsEvent` call in the codebase is `candidate.hired` in offer-finalize.ts:129 — even the accept path that exists doesn't emit `offer.accepted`, and the decline branch right below it (offer-finalize.ts:136+) emits nothing.
- **Root cause**: The event contract, config validation (`SUBSCRIBABLE_EVENTS`), and UI checkboxes were built for four lifecycle events, but only one producer was ever wired. The UI's footnote ("the others are reserved for their lifecycle hooks") is the sole disclosure, in `text-meta` fine print, while the checkboxes accept and persist the subscription as if it were live.
- **Impact**: Silent integration gap — the receiving ATS shows hires but never rejections/declines, skewing the mirrored pipeline; debugging lands on the integrator, who has no way to distinguish "not subscribed correctly" from "never emitted".
- **Fix sketch**: Cheapest honest fix: wire `offer.declined` and `offer.accepted` in the same offer-finalize branches that already dispatch hired (the record builder and ledger are event-agnostic), and `candidate.rejected` at the reject decision point. Until each producer exists, render its checkbox disabled with a "not yet emitted" tag instead of a persistable no-op subscription.

## 3. Envelope has no delivery/event id — receivers cannot deduplicate retried events
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: missing-idempotency-key
- **File**: `app/_lib/ats-webhook.ts:41-43` (buildEnvelope), `app/_lib/ats-egress.ts:132-154` (retry loop)
- **Scenario**: A delivery times out after 5s but the receiver actually processed it (timeout ≠ not received). The ledger marks it failed; `retryDueAtsDeliveries` later re-sends the same `candidate.hired` with a fresh `sentAt` and a re-built record. The receiver sees two syntactically different, both validly-signed events for the same hire and double-writes it.
- **Root cause**: `WebhookEnvelope` carries only `event`, `sentAt`, `schemaVersion`, `data` — no stable delivery id or `(event, candidateRef)` idempotency key, even though the durable ledger already mints a `deliveryId` (`recordAtsDeliveryStart`, ats-egress.ts:117) that is never put on the wire. Standard webhook contracts (Stripe `id`, GitHub `X-GitHub-Delivery`) exist precisely for this.
- **Impact**: At-least-once delivery with no dedupe handle means every timeout/5xx retry risks duplicate hires in the customer's system of record; the "stable versioned record" contract is undermined by an unstable envelope.
- **Fix sketch**: Add `deliveryId` (the ledger id, or a UUID minted at `recordAtsDeliveryStart` and stored on the row) to the envelope and/or an `X-Kp-Delivery` header, reused verbatim on every retry of that ledger row. Document that receivers should dedupe on it. Additive field — no `kp.ats.v1` version bump needed.

## 4. Save is live before the config loads — one early click silently wipes the stored webhook config
- **Severity**: Medium
- **Lens**: ui
- **Category**: missing-loading-state
- **File**: `app/features/tasks/IntegrationsCard.tsx:40-55` (fetch effect), `:59-84` (save), `:164-172` (Save button)
- **Scenario**: An operator opens the tab on a slow connection and clicks Save while the GET `/api/ats/config` is still in flight (or after it failed — the toast fires but the form stays editable). The POST sends `{ webhookUrl: "", events: [] }`, which the store treats as "disable delivery + unsubscribe everything" — the working integration is turned off with no confirmation, and the in-flight GET may then repopulate the form with the now-stale values, hiding what happened.
- **Root cause**: The component's own comment (line 50) names exactly this hazard ("saving it would overwrite the stored config with blanks") but only addresses the fetch-*failure* case, and only with a toast — there is no `loading` state, so `busy` is false and both Save and the inputs are enabled from first paint; a failed load doesn't disable Save either.
- **Impact**: A single misclick destroys operator config (URL + subscriptions; the secret survives only because it's omitted-when-blank), and lifecycle events silently stop flowing until someone notices the mirror is stale.
- **Fix sketch**: Add a `loaded` state: render inputs/buttons disabled (or a skeleton) until the GET settles, and keep Save disabled when the load failed (show a retry affordance instead). This is the same pattern the sibling operator cards need anyway and costs ~10 lines.

## 5. The signing secret can never be cleared from the UI — the store supports it, the form can't express it
- **Severity**: Medium
- **Lens**: ui
- **Category**: unreachable-store-contract
- **File**: `app/features/tasks/IntegrationsCard.tsx:66` (`if (secret) body.webhookSecret = secret;`), contract at `app/_lib/ats-config-store.ts:121-125`
- **Scenario**: A secret is compromised (or the receiver drops signature verification) and the operator wants to remove it. The store's documented contract is `webhookSecret: "" → CLEAR`, but the UI sends the field only when non-empty, so a blank input always means "keep". The hint text ("set · leave blank to keep") confirms keep-semantics and offers no removal path at all — the only workaround is a hand-crafted curl.
- **Root cause**: The truthiness guard `if (secret)` conflates "operator didn't touch the field" with "operator wants it empty"; a tri-state (untouched / replace / clear) was flattened to two states in the form.
- **Impact**: An operator cannot rotate-to-unsigned or revoke a leaked secret without leaving the product; worse, they may believe blanking the field cleared it while every delivery is still being signed with the compromised key.
- **Fix sketch**: Add an explicit "Remove secret" control (shown only when `hasSecret`) that sends `webhookSecret: ""` after a confirm, keeping the blank-means-keep behavior for the text field itself. Update the hint to mention both paths.

## 6. `automated` flag: comment says `"human:"`-prefixed, code matches any actor merely *starting* with "human"
- **Severity**: Low
- **Lens**: ambiguity
- **Category**: doc-code-drift
- **File**: `app/_lib/ats-record.ts:100-105` (impl), `:87` (field doc)
- **Scenario**: A decision actor named `humanloop-agent`, `humane-ai`, or `Humanity-bot` (an automated system) is exported with `automated: false` — the record's own docstring promises the derivation keys on a `"human:"`-prefixed actor, but `isAutomatedActor` checks `!actor.toLowerCase().startsWith("human")`, dropping the colon.
- **Root cause**: The prefix check was loosened (case-insensitive, no colon) without updating the two doc comments that state the `"human:"` contract; the deliberately conservative "only call it human when it SAYS human" doctrine is undermined by matching a bare substring prefix.
- **Impact**: The `automated` attribution is compliance-adjacent (it mirrors the sealed decision's auto/human attribution into an external system of record); a misclassified automated decision reads as a human one downstream — the exact direction the inverted doctrine was meant to forbid.
- **Fix sketch**: Match the documented contract exactly: `!actor.toLowerCase().startsWith("human:")` (optionally also accepting the literal `"human"`), and add a unit case for a `human*`-named bot. Alternatively pass through the source attribution field instead of re-deriving from the actor string.
