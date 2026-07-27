# COMMS_DELIVERY — Outbound Comms Delivery & Recipient Contract

> Scope: the **outbound** side (Direction B) — every candidate-facing message the
> pipeline sends (intake acks, promote invites, recruiter outreach, rejections,
> offers, interview confirmations/reminders, onboarding). Code: `app/_lib/comms.ts`
> (channels), `app/_lib/comms-dispatch.ts` (message builders + recipient), and the
> single source of truth `app/_lib/comms-status.ts`. The inbound Channels inbox is a
> separate concern.

In a recruiting product a silently-dropped offer or rejection is a serious,
candidate-facing failure. The outbox used to make `queued` and `failed` look equally
benign and never escalated — once a real relay is wired, outreach could vanish without
a trace. This doc pins the three ambiguities the implementation now resolves.

## 1. Channels

`getCommsChannel()` picks the channel by environment:

| Condition | Channel | What happens |
|-----------|---------|--------------|
| `COMMS_WEBHOOK_URL` **unset** | `OutboxChannel` (local) | Records the message in `dev_outbox` as `queued`. Nothing is delivered — the outbox **is** the destination. |
| `COMMS_WEBHOOK_URL` **set** | `WebhookChannel` | `POST`s the **`kp.comm.v1` envelope** (the message's flat fields plus candidate/job/stage context — the documented kp → ATS export schema, see `docs/OUTBOUND_EXPORT.md`) to the relay; records `sent` or `failed`. |

Every message is recorded in `dev_outbox` either way, so the table doubles as the
permanent audit log.

## 2. The status contract (single source of truth)

Defined once in `comms-status.ts` as `OUTBOX_STATUSES` / `OutboxStatus`. **Three
mutually-exclusive, terminal states:**

| Status | Meaning | Terminal? | Action |
|--------|---------|-----------|--------|
| `queued` | Recorded in the local outbox; **no relay configured**. | **Yes — terminal dev state.** | None. There is no worker, dequeue, delivery, or retry. The local outbox is the delivery target (a dev inbox + audit log). Offline, this is the *success* outcome. |
| `sent` | Delivered to the configured relay (HTTP 2xx). | Yes | None. |
| `failed` | Relay configured but delivery **dead-lettered** — a non-retryable response, or a transient failure that exhausted retries. | Yes | **Escalated.** Candidate-facing drop: alerted loudly (`console.error`) and durably (`comms.log`). |

### Q: Is `queued` a terminal dev state or a real pending one?
**Terminal dev state.** Nothing in the system ever transitions a `queued` row. Treating
it as "pending" would imply a delivery worker that does not exist. When `relayConfigured`
is `false` (exposed by `/api/devcase/comms`), `queued` means "recorded locally, offline";
if it ever appears *with* a relay configured, that is a bug, not a pending send.

## 3. Webhook failures: retry **and** dead-letter

There is no durable queue or background worker, so retries happen **inline, bounded**,
within the send (`WebhookChannel.deliver`):

- **Transient** failures — network/DNS errors, `408`, `425`, `429`, any `5xx`
  (`isRetryableHttpStatus`) — are retried with exponential backoff:
  `COMMS_RELAY_RETRY` = `maxAttempts: 3`, `baseDelayMs: 200` (so 200ms, then 400ms).
- **Permanent** failures — other `4xx` (`400/401/403/404/422` …) — are caller/config
  errors that fail identically on retry, so they **dead-letter immediately** instead of
  burning attempts.
- When retries are exhausted (or on a permanent failure) the message is recorded
  `failed` and **`alertDeadLetter`** fires: `console.error` + a structured `comms.log`
  line (`logComms`). This is the escalation the old silent `failed` row never raised.

> A production deployment should ship `comms.log` to an alerting sink (and, ideally,
> add a durable retry queue) so candidate-facing drops page a human.

## 4. Recipient contract: what the relay actually receives

The data model stores **no candidate email**, so the relay never receives a deliverable
address from us. `candidateRecipient()` (comms-dispatch.ts) resolves a best-effort
**identifier**, in priority order:

1. `candidateLabel` — the human display name (normal case). A relay/ATS maps name →
   address via its own directory.
2. `candidateId` — a stable opaque id when no label exists.
3. `"candidate"` — last-resort literal. **Unaddressable**: a relay cannot deliver to it,
   so such a message will dead-letter.

Every `OutboundMessage` also carries `ref` (the pipeline entry id), so even an
unaddressable or dropped message stays traceable to a specific candidate in the audit
log and the dead-letter alert.

**This is the email-enrichment seam:** before wiring a production relay, store/resolve a
real address in `candidateRecipient` (or upstream in the data model) so identifiers stop
leaking through as the recipient.

## 5. Interview-reminder policy (sub-24h bookings)

Confirmed interviews get one timed reminder, fired by the heartbeat sweep
(`sendDueInterviewReminders` → `dueReminders`). The sweep once leaned on a single
`24h` number for two unrelated jobs, so the policy below was an accident of an
inequality rather than a decision. It is now pinned in
`app/_lib/interview-reminder-policy.ts` and locked by
`interview-reminder-policy.test.ts`.

| Constant | Value | Role |
|----------|-------|------|
| `REMINDER_LEAD_MS` | 24h | **Look-ahead window.** A reminder fires once the slot's start falls within this much time and none has been sent. |
| `REMINDER_MIN_NOTICE_MS` | 2h | **Short-notice floor.** If the candidate confirms with this little time (or less) left before the slot, no timed reminder is sent — the confirmation note IS the reminder. |
| `REMINDER_MAX_ATTEMPTS` | 5 | **Retry cap.** After this many failed dispatch attempts the heartbeat gives up on the invite (and logs) instead of retrying forever. |
| `REMINDER_RETRY_BASE_MS` | 1m | **Backoff base.** Gap before the first retry; doubles each attempt (`reminderRetryDelayMs`), capped by `REMINDER_RETRY_MAX_BACKOFF_MS` (30m). |

### Q: What does a candidate who books less than 24h out receive?
**A reminder, unless they're inside the short-notice floor.** The old code skipped
*every* booking confirmed under 24h out — so last-minute bookers got nothing while
still being told "we'll send a reminder." Now:

- **Confirmed > floor before the slot** (e.g. 8h out): in-window and above the floor →
  a (shortened-notice) reminder still fires. Confirmation copy promises the reminder.
- **Confirmed ≤ floor before the slot** (e.g. 30 min out): a separate reminder would
  land moments behind the confirmation, so it is suppressed. The confirmation
  (`dispatchInterviewConfirmation`, `opts.shortNotice`) instead reads as a "see you
  soon" note and does **not** promise a later reminder — keeping the copy honest.

The two durations are deliberately unequal so the silent-gap coincidence cannot
reappear; `isReminderDue` / `isShortNoticeBooking` are pure so the decision is
unit-testable without the DB or the clock.

### Q: What happens when a reminder fails to dispatch?

**It is retried a bounded number of times with a growing backoff, then given up.**
The old sweep reset the claim to `NULL` on *any* dispatch error, so the next ~60s
tick re-claimed and re-fired immediately. A down comms provider therefore turned
into a tight re-claim/re-fail/re-release storm across every due invite, and a
dispatch that delivered-then-threw (e.g. a post-send audit write) got re-armed and
sent the candidate a **duplicate**. Now each attempt is claimed atomically
(`claimReminderAttempt` records the attempt + stamps the time on the
`reminder_attempts` / `reminder_last_attempt_at` columns), retries are spaced by
`reminderRetryDelayMs` (1m → 2m → 4m …, capped at 30m) and capped at
`REMINDER_MAX_ATTEMPTS`, after which the heartbeat logs and stops. `reminder_sent_at`
is now set **only on success** (`markReminderSent`), and the post-send audit write in
`dispatchInterviewReminder` is swallowed-and-logged — a throw from dispatch means the
message did not go out, so a failed attempt is left to age past its backoff rather
than released for an immediate (duplicate-risking) re-send. `reminderRetryDelayMs`
and the cap are pure, so the retry cadence is locked in
`interview-reminder-policy.test.ts`.

## 6. Legacy normalization

Pre-contract rows stored the HTTP code inline (e.g. `failed:500`). `coerceOutboxStatus`
(applied in `listOutbox`) maps any such value — and any other unrecognized string — to
the canonical enum, defaulting unknowns to `failed` (safer to over-report a drop than to
mislabel one as `sent`/`queued`). The membership, normalization, and retry classification
are locked by `comms-status.test.ts`.

## 7. Asynchronous bounce / delivery receipts (the `bounced` state)

A relay's HTTP 2xx on send means *"the relay accepted the POST"*, not *"the
candidate received it"*. The outcomes that decide deliverability for email —
a hard **bounce**, a spam **complaint**, a **drop** — are asynchronous and arrive
later, out-of-band. `POST /api/comms/callback` is where a configured relay
(SendGrid/Mailgun/Postmark/an ATS) reports them back, keyed by the message's
`ref` (pipeline entry id) + `kind`:

- **Auth is fail-closed.** The endpoint returns `503` unless `COMMS_CALLBACK_SECRET`
  is set; when it is, every call must present it as the `x-comms-secret` **header**
  — the `?secret=` query form was dropped, because URLs are logged and forwarded by
  design. The compare is constant-time; an `x-comms-timestamp` (ISO-8601 or epoch-ms)
  must be within ±5 minutes, and an in-process nonce guard drops an exact replay
  inside that window. An unconfigured deployment cannot be poked by a forged receipt.
- **The path is on the public allow-list** (`app/_lib/auth/public-routes.ts`), same
  rationale as `/api/billing/webhook` and `/api/devcase/inbound`: a machine posts
  here with no session cookie, so the operator gate (`proxy.ts`) would `401` the
  relay *before* the shared-secret auth above ever ran — which left the entire bounce
  subsystem inert in any password-protected deployment. Only `/api/comms/callback`
  is public; the recruiter read (`/api/comms`) and resend stay gated, and the entry
  is pinned by `public-routes.test.ts`.
- **Unmatched ("orphan") receipts are answered, not swallowed.** A receipt is keyed
  only by `(ref, kind)`. If no send of ours matches that pair — an integrator on a
  different ref scheme, or a `kind` kp does not emit — the response is
  `{ recorded: false, reason: "no_matching_send", stored: true }`, so the vocabulary
  mismatch surfaces on the FIRST call instead of accumulating invisible rows. The
  receipt is still stored (append-only), and `deriveCommsView` surfaces it in the
  Comms Center as an actionable **unmatched receipt** (`orphaned: true`) instead of
  dropping it. Orphan state is *derived*, never frozen into a column, so a receipt
  that arrives before its send folds normally once the send lands.
- **Bounce-class outcomes** (`isBounceOutcome`: bounced/complaint/spam/dropped/failed)
  record an **append-only** `bounced` outbox RECEIPT row (`channel = relay-callback`,
  `body = the bounce detail`). Positive/soft outcomes (delivered/opened/deferred) are
  accepted with `{ recorded: false }` so the relay stops retrying, but are not yet
  surfaced (future engagement feed).
- **The receipt supersedes the green `sent`.** `deriveCommsView` (`comms-view.ts`)
  folds a `bounced` receipt onto its originating `sent` row — the row's derived
  `bounced` flag flips it to a red **bounced** badge in the Comms Center, makes it
  actionable (it joins the dead-letter "needs attention" set), and carries the
  bounce detail. This mirrors the inverse `recovered` derivation (a later OK
  supersedes a `failed`). The original `sent` row stays as the audit record; a
  resend issued *after* the bounce is a fresh, un-superseded send. The supersession
  logic is locked by `comms-view.test.ts`.

This is why "sent" is no longer read as success on its own: a hard bounce at the
offer/rejection moment is exactly the reputation-sensitive failure a recruiter must
chase, not trust as delivered.
