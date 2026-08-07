# Communications & Inbound Channels — bug-hunter + ui-perfectionist scan

> Context: Outbound candidate communications (envelopes, dispatch, delivery status, resend, async bounce callback) and inbound channel webhooks/tokens that feed applications into the pipeline.
> Files reviewed: 26 of 33
> Total: 5

## 1. Trash-icon revoke kills a live intake endpoint with no confirmation

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing-ui-state / unguarded-destructive-action
- **File**: `app/features/sub_channels/channel-receivers.tsx:101-114`, `app/features/sub_channels/use-receivers.ts:32-49`
- **Scenario**: In the Email intake or Ad forms pane a recruiter clicks the small `Trash2` button on a receiver row (a row that may show `Received: 214`, badge "Listening"). `onRevoke(h.token)` fires immediately — no confirm dialog, no "are you sure" — and `revoke()` DELETEs the webhook. `revokeChannelWebhook` sets `revoked_at`; from then the token 404s (`getActiveChannelWebhook` filters `revoked_at IS NULL`) and there is no un-revoke path in `db/channels.ts`.
- **Root cause**: The row treats destroying a public, externally-wired integration as an ordinary inline action. The consequence lives *outside* the app (a Gmail forwarding rule / a Zapier→Meta flow now posts to a dead URL), so the UI can't undo it — yet it guards it less than a normal delete.
- **Impact**: One misclick silently severs a role's live application intake; the external forwarding/ad rule keeps POSTing to a 404 and applications are dropped until someone notices, mints a *new* token, and re-does the third-party config. No toast even confirms the revoke happened.
- **Fix sketch**: Gate revoke behind a confirm step (reuse `Modal`) that names the role and warns "the forwarding rule will stop working," especially when `isReceiverLive(h)`. Longer term, prefer a reversible "pause" (a `paused_at` the receiver honors) so an accidental disable is recoverable without re-wiring the source.

## 2. A single bounce receipt marks every prior same-kind send as bounced

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: state-corruption / silent-wrong-result
- **File**: `app/_lib/comms-view.ts:87-97`, `app/api/comms/callback/route.ts:38-63`
- **Scenario**: A relay callback records a `bounced` receipt keyed only by `(ref, kind)` — the body carries no message id, and `recordOutbox` stamps `createdAt = now`. In `deriveCommsView`, `latestBounce` holds one receipt per key, and the fold marks `bounced = true` for *every* `sent` row where `bounce.at >= m.createdAt`. So if an offer was sent (row A, T1), the recruiter thought it hung and resent it (row B, T2, both accepted by the relay), then the relay reports a bounce for A at T3 — the fold marks **both A and B bounced**, because T3 ≥ T1 and T3 ≥ T2.
- **Root cause**: The bounce↔send correspondence is inferred from `(ref, kind)` + a time comparison instead of a message identity. The callback cannot attribute a bounce to the specific send it concerns, and the view has no way to bind a receipt to exactly one sent row.
- **Impact**: A genuinely delivered offer/rejection is shown "Bounced" (critical badge, red row). The recruiter chases a non-problem and may fire a *third* duplicate offer — the exact hazard the resend dedup elsewhere tries to prevent. It also lets one late callback retroactively invalidate an unrelated later send of the same kind.
- **Fix sketch**: Carry the originating outbox row id in the send envelope and echo it in the callback body; fold the bounce onto that one row (`WHERE id = ?`). If identity isn't available, at minimum bind a bounce to the single newest `sent` row at or before `bounce.at`, not all of them.

## 3. Bounced messages are flagged "chase" but the modal offers no way to act

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing-ui-state / dead-control
- **File**: `app/features/sub_channels/CommsTable.tsx:45,199-208,257-273`
- **Scenario**: `isActionable` counts a bounced row (`Boolean(m.bounced)`), so it gets a red background, a "Bounced" critical badge, and is counted in the "chase dead letters" toggle. The recruiter clicks it; the modal shows a red "Bounced at … / detail …" alert — but the resend affordance is gated on `open.status === "failed" && !open.recovered`, and a bounced row is a *sent* row (`status === "sent"`, `bounced === true`). So the one row the UI most loudly says to act on has **no in-app action at all**.
- **Root cause**: The actionable set was widened to include bounces (correctly), but the modal's action gate still keys off the old `failed` status only, so the two notions of "actionable" diverged.
- **Impact**: A dead end on the highest-stakes state — an offer/rejection that reached no one. The recruiter is told to chase it with no button to resend (to a corrected address) or dismiss it, so it sits red forever and the "dead letters" count never clears.
- **Fix sketch**: Show a resend (and/or "mark handled") action whenever `isActionable(open)` is true, not only for `failed`. For a bounce, prompt for/allow a corrected recipient before resending, since resending to the same address will bounce again.

## 4. Delivery callback authenticates via a query-string secret and a non-constant-time compare

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: trust-boundary / secret-leakage
- **File**: `app/api/comms/callback/route.ts:25-32`
- **Scenario**: The endpoint accepts the shared secret either as the `x-comms-secret` header *or* as `?secret=` in the URL, then compares with `presented !== secret`. Any relay/ATS configured with the query-string form leaks `COMMS_CALLBACK_SECRET` verbatim into every access log, reverse-proxy log, and `Referer` header along the request path. Separately, the `!==` compare is not constant-time. There is also no nonce/timestamp, so a captured valid callback replays indefinitely.
- **Root cause**: A bearer secret is treated as an ordinary request parameter. URLs are logged and forwarded by design; a secret placed there is effectively logged in clear. The equality check leaks length/prefix timing, and nothing binds a callback to a single use.
- **Impact**: The whole auth of the bounce channel is one static secret; once it lands in a log an attacker can forge `bounced` receipts (flip real "sent" offers to "Bounced" in the recruiter's ledger) or replay old ones. Blast radius is bounded by whether the secret is set and how it's configured, hence Medium.
- **Fix sketch**: Accept the secret only via header (drop the `searchParams` branch), compare with `crypto.timingSafeEqual` over fixed-length buffers, and prefer an HMAC signature over the raw body with a timestamp window so receipts can't be replayed or forged from a leaked static token.

## 5. Candidate-comms locale fallback is hard-wired to the default workspace

- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case / latent-tenancy
- **File**: `app/_lib/comms-locale.ts:26-33`, `app/_lib/db/workspaces.ts:50-57`
- **Scenario**: `resolveCommsLocale(entry.locale)` falls back to `getWorkspaceDefaultLocale()` **with no argument**, which always reads `DEFAULT_WORKSPACE_ID` ("workspace"). The inbound webhook already files leads into a *specific* team via `webhook.workspaceId` (`intakeLead`/`ingestCvApplication` in `inbound/[token]/route.ts:143,218`). The moment a second workspace exists whose `default_locale` differs from the default team's, a NULL-locale candidate filed into that team resolves — and gets emailed — in the *default* workspace's language, not their own team's. The same hard-wiring skews `formatOfferDeadline`'s date locale.
- **Root cause**: A per-workspace read is invoked without the entry's workspace id, so a workspace-scoped setting is silently sourced from a fixed tenant. Not a "table lacks workspace_id" gap — the column and the entry's workspace both exist; the call just ignores them.
- **Impact**: Wrong-language candidate emails (and mis-localized offer deadlines) for any non-default team once multi-workspace is enabled. Not reachable today (all webhooks default to `"workspace"`), so Low — but it's a correctness landmine that ships silently the first day a second team is created.
- **Fix sketch**: Thread the entry's `workspaceId` into `resolveCommsLocale` and pass it to `getWorkspaceDefaultLocale(workspaceId)`; the dispatchers already hold the `PipelineEntry`, so the id is in scope at every call site.
