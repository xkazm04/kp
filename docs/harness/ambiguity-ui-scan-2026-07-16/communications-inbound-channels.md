# Communications & Inbound Channels — ambiguity-guardian + ui-perfectionist scan

> Total: 6 findings (0 critical, 2 high, 2 medium, 2 low)

## 1. Email intake wizard hands out a forwarding address nothing serves
- **Severity**: High
- **Lens**: ambiguity
- **Category**: fabricated-capability
- **File**: `app/features/sub_channels/EmailIntakeWizard.tsx:22`
- **Scenario**: A recruiter opens Email intake, adds a role inbox, and follows the 4-step Gmail guide: add `hook_xxx@inbound.<host>` as a forwarding address, wait for the confirmation code that the guide promises "arrives here as the first item in Communications", then forward every application there. Nothing ever arrives — the code, or the applications.
- **Root cause**: `parseAddress()` synthesizes `${token}@inbound.<host>` (falling back to the hardcoded `inbound.kp.app`), but no inbound-email provider (Postmark/SendGrid/Mailgun) or MX route exists anywhere in the repo — the only real receiver is HTTP `/api/channels/inbound/[token]`. The module comment admits "a production build swaps the demo address for a real inbound-email provider", but the UI carries no capability gate, no "demo" flag, and no warning — unlike the comms side, which rigorously gates every "sent" claim through `isRelayConfigured()`.
- **Impact**: Real candidate applications are silently forwarded into a void; the receiver forever shows "Waiting for the first forward…" with no way to diagnose why. This directly violates the codebase's own REC-10 honesty doctrine (comms-truth.ts) on the intake side.
- **Fix sketch**: Introduce an `EMAIL_INBOUND_DOMAIN` (or similar) capability bit mirroring `COMMS_WEBHOOK_URL`: when unset, replace the fabricated address with the real HTTP receiver URL plus a visible "email forwarding isn't wired yet — this channel currently accepts direct POSTs only" banner, and hide the Gmail/Outlook step lists. When set, derive the address from the configured domain instead of guessing from `window.location`.

## 2. `received_count` has two contradictory contracts — misconfigured integrations look dead
- **Severity**: High
- **Lens**: ambiguity
- **Category**: liveness-signal-drift
- **File**: `app/_lib/db/channels.ts:126`
- **Scenario**: A recruiter wires a Zapier→Meta flow that maps the email field wrong. Every lead POSTs in and gets a 422; the Channels tab keeps showing the receiver as "Waiting" / badge "Off", Received stays 0, and the setup guide says "Waiting for the first lead…" — indistinguishable from a flow that was never turned on.
- **Root cause**: `recordChannelWebhookReceipt` is documented as "the connection LIVENESS signal, stamped for ANY POST (a probe, a malformed body, a closed-role hit)", and `isReceiverLive` / the ReceiverTable "Received" column / the "Listening" badge are all built on that meaning. But the receiver (`app/api/channels/inbound/[token]/route.ts:250` and `:145`) deliberately stamps it only after intake reaches a terminal outcome — 400/410/413/422 rejections, thrown intakes, and idempotent duplicates all return without stamping. The two halves were written to different contracts.
- **Impact**: The one signal designed to distinguish "connected but mis-mapped" from "not connected" cannot do so — the highest-value diagnostic during channel setup is structurally blind, and the doc comment actively misleads the next maintainer.
- **Fix sketch**: Decide one contract. Simplest true-to-doc fix: stamp the receipt immediately after token resolution (any authenticated POST proves liveness), keep `accepted_count` as the honest lead metric, and drop the "only after terminal outcome" logic — the receipt-inflation worry the route comment cites is exactly what `accepted_count` was added to solve. Otherwise rewrite the channels.ts comment and the "Received" column semantics to "processed submissions".

## 3. Add-receiver modal reads `p.token` from a response that returns `{ webhook }`
- **Severity**: Medium
- **Lens**: ui
- **Category**: response-shape-mismatch
- **File**: `app/features/sub_channels/channel-receivers.tsx:203`
- **Scenario**: With two receivers listed, a recruiter selects the older one (its setup guide shows), then adds a receiver for a new role. The modal closes, but the setup guide and CV-sim card silently stay on the previously selected receiver — the new receiver's guide, the whole point of creating it, never appears.
- **Root cause**: `AddReceiverModal` calls `onCreated(typeof p.token === "string" ? p.token : "")`, but `POST /api/channels/webhooks` returns `{ webhook: {...} }` (`app/api/channels/webhooks/route.ts:37`), so `p.token` is always `undefined` and `onCreated("")` fires; both panes then skip `setSelectedToken` (`if (token) …`). Auto-select only ever "works" by accident when nothing was selected, because `selected` falls back to `list[0]` (newest-first).
- **Impact**: The select-the-new-receiver behavior is dead code; in the multi-receiver case the user is shown the wrong role's endpoint and steps right after creating a new one — an easy way to point Gmail/Zapier at the wrong token.
- **Fix sketch**: Read the shape the API actually returns: `onCreated(typeof p.webhook?.token === "string" ? p.webhook.token : "")`. Better, type the response with `ChannelWebhookRecord` so tsc pins the contract, and have the route keep returning the full record.

## 4. Bounce receipts that match no `sent` row are recorded, then invisible everywhere
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: silent-signal-drop
- **File**: `app/_lib/comms-view.ts:115`
- **Scenario**: The relay POSTs a bounce receipt to `/api/comms/callback` with the candidate's `ref` but its own outcome vocabulary in `kind` (or for a message whose send row is outside the 200-row window, or that only exists as `queued`). The callback answers `{ recorded: true }` — yet no surface ever shows a bounce: the Comms Center row stays green "Sent" (or "Queued") forever.
- **Root cause**: The callback validates only that `ref`/`kind` are non-empty strings (`app/api/comms/callback/route.ts:64-69`) — it never checks that a matching outbox send exists. `deriveCommsView` then drops every `bounced` row from the returned list (`comms-view.ts:115`) and surfaces a bounce only when `pickBounceTarget` finds a preceding same-`(ref,kind)` `sent` row. An unattached receipt is stored as truth and displayed nowhere.
- **Impact**: The exact failure the bounce pipeline exists to catch — an undeliverable offer/rejection — can be acknowledged to the relay and still silently lost, defeating the "never trust a false sent" contract the whole CW-2 design is built on. A `kind` casing/vocabulary mismatch from a real relay makes this the default behavior, not an edge case.
- **Fix sketch**: In the callback, look up whether an outbox row with that `(ref, kind)` exists; on miss, either respond `recorded: false, reason: "no_matching_send"` (so integration tests catch the vocabulary mismatch immediately) or record it flagged. In `deriveCommsView`, emit unattached bounce receipts as their own actionable rows instead of `continue`-dropping them, so an orphan bounce is at least visible in the dead-letter view.

## 5. `KNOWN_COMM_KINDS` claims to be "the kinds the dispatchers emit today" but misses five
- **Severity**: Low
- **Lens**: ambiguity
- **Category**: stale-contract-doc
- **File**: `app/_lib/comms-envelope.ts:25`
- **Scenario**: A relay integrator reads the documented export vocabulary (also mirrored into docs/OUTBOUND_EXPORT.md per the header) and writes per-kind routing for the eight listed kinds. Real traffic then arrives with `ko_decline`, `schedule_invite`, `interviewer_brief`, `onboarding_reminder`, and `offer_reminder` — none in the list.
- **Root cause**: The constant is annotated "The kind vocabulary the pipeline dispatchers emit today (comms-dispatch.ts)", but comms-dispatch.ts has since grown five more kinds (`comms-dispatch.ts:284, 411, 435, 528, 558`) and nothing (test or type) ties the list to the dispatch call sites.
- **Impact**: Low only because the list is explicitly "documentation-adjacent, not enforcement" and unknown kinds pass through — but the "today" claim is now false, and an integrator who trusts it mis-buckets five real message classes (including money-adjacent offer reminders).
- **Fix sketch**: Either derive the constant from a single kinds registry that the dispatchers import (so a new kind can't be added without appearing here), or add a unit test that greps/loads the dispatch module's emitted kinds and asserts set equality — and refresh the list now.

## 6. Comms table dates every row under a "Sent" header — including messages that were never sent
- **Severity**: Low
- **Lens**: ui
- **Category**: mislabeled-column
- **File**: `app/features/sub_channels/CommsTable.tsx:255`
- **Scenario**: With no relay configured (every row terminal `queued`, the red "NOT being sent" banner showing), or with a failed dead-letter row, the register's last column still says "Sent" over a timestamp — the table's own header contradicts the honesty banner two inches above it. Same-day original + resend rows also show identical values because only `toLocaleDateString()` renders.
- **Root cause**: The column renders `createdAt` (when the row was recorded) but is titled after the happy-path status; every other status word on this surface is carefully routed through `statusTone`/comms-truth, this header was missed. Date-only formatting drops the time that distinguishes an original from its recovery resend.
- **Impact**: Papercut, but on the one surface whose stated purpose is truthful delivery language; it also makes verifying "the resend went after the failure" impossible without opening both modals.
- **Fix sketch**: Retitle the column to a status-neutral "Recorded" (or "Date") and render date + short time (`toLocaleString` with `dateStyle: "short", timeStyle: "short"`), keeping `whitespace-nowrap`.
