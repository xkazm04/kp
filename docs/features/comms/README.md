# Outbound Candidate Comms

Every candidate-facing message the pipeline sends — intake acknowledgements,
outreach, rejections, offers, interview confirmations/reminders, onboarding —
goes through one delivery layer with an honest, non-ambiguous status contract.
In a recruiting product a silently-dropped offer or rejection is a serious,
candidate-facing failure; this doc pins the three ambiguities the
implementation resolves so `sent` never has to be double-checked.

Scope: the **outbound** side. Code: `app/_lib/comms.ts` (channel selection +
delivery), `app/_lib/comms-dispatch.ts` (message builders + recipient
resolution), `app/_lib/comms-status.ts` (the single source of truth for
statuses), `app/_lib/comms-relay.ts` / `comms-relay-store.ts` (relay
configuration). The inbound Channels inbox (email/board webhooks) is a
separate concern — see `docs/features/pipeline/README.md` for where leads
enter the funnel. The wire schema is in [outbound-export.md](./outbound-export.md).

## 1. Channel selection

`getCommsChannel()` (`comms.ts`) picks the channel via `resolveRelay()`
(`comms-relay.ts`), which resolves **env → stored config → nothing**:

| Source | Condition | Channel | What happens |
|---|---|---|---|
| — | Neither env nor stored config set | `OutboxChannel` (local) | Records the message in `dev_outbox` as `queued`. Nothing is delivered — the outbox **is** the destination. |
| `env` | `COMMS_WEBHOOK_URL` set | `WebhookChannel` | POSTs the `kp.comm.v1` envelope to that URL; no HMAC secret (env path never carried one). |
| `config` | A relay URL is saved via the UI (`RelayConfigCard` on the Channels tab) | `WebhookChannel` | POSTs the envelope to the stored URL, HMAC-signed with the stored secret (`x-kp-signature`, same scheme as the ATS webhook) when one is configured. |

Env keeps precedence so an existing `COMMS_WEBHOOK_URL` deployment behaves
exactly as before. `isRelayConfigured()` is the one capability bit every
"sent" claim, the channel selection, and the Comms Center banner key off — a
misconfigured stored relay (e.g. an undecryptable secret) is treated as
unconfigured rather than taking the whole capability check down.

Every message is recorded in `dev_outbox` either way, so the table doubles as
the permanent audit log.

## 2. The status contract (single source of truth)

Defined once in `comms-status.ts` as `OUTBOX_STATUSES` / `OutboxStatus`.
Three mutually exclusive, terminal states:

| Status | Meaning | Terminal? | Action |
|---|---|---|---|
| `queued` | Recorded in the local outbox; no relay configured. | **Yes — terminal dev state.** | None. There is no worker, dequeue, delivery, or retry. Offline, this is the *success* outcome. |
| `sent` | Delivered to the configured relay (HTTP 2xx). | Yes | None. |
| `failed` | Relay configured but delivery dead-lettered (non-retryable response, or a transient failure that exhausted retries). | Yes | Escalated: alerted loudly (`console.error`) and durably (`comms.log`). |

If `queued` ever appears *with* a relay configured, that is a bug, not a
pending send — nothing in the system transitions a `queued` row.

## 3. Webhook failures: retry and dead-letter

No durable queue or background worker — retries happen inline, bounded,
within the send (`WebhookChannel.deliver`):

- **Transient** failures (network/DNS errors, `408`, `425`, `429`, any `5xx`
  — `isRetryableHttpStatus`) retry with exponential backoff:
  `COMMS_RELAY_RETRY` = `maxAttempts: 3`, `baseDelayMs: 200` (200ms, then 400ms).
- **Permanent** failures (other `4xx`) dead-letter immediately — retrying a
  caller/config error changes nothing.
- Exhausted retries or a permanent failure record the message `failed` and
  fire **`alertDeadLetter`** (`console.error` + a structured `comms.log` line).

> A production deployment should ship `comms.log` to an alerting sink (and,
> ideally, add a durable retry queue) so candidate-facing drops page a human.

## 4. Recipient contract

The data model stores no guaranteed candidate email, so `candidateRecipient()`
(`comms-dispatch.ts`) resolves a best-effort **identifier**, in priority
order: `candidateLabel` (display name) → `candidateId` (stable opaque id) →
`"candidate"` (last-resort literal, unaddressable — a relay cannot deliver to
it, so such a message dead-letters). Every `OutboundMessage` carries `ref`
(the pipeline entry id) so even an unaddressable message stays traceable.
When a real email *is* captured at intake (quick-apply requires one), it
rides the envelope as `candidate.email` — see outbound-export.md.

## 5. Interview-reminder policy (sub-24h bookings)

Confirmed interviews get one timed reminder, fired by the heartbeat sweep
(`sendDueInterviewReminders` → `dueReminders`), pinned in
`app/_lib/interview-reminder-policy.ts` / `interview-reminder-policy.test.ts`:

| Constant | Value | Role |
|---|---|---|
| `REMINDER_LEAD_MS` | 24h | Look-ahead window — a reminder fires once the slot falls inside it and none has been sent. |
| `REMINDER_MIN_NOTICE_MS` | 2h | Short-notice floor — inside this, no timed reminder fires; the confirmation note IS the reminder. |
| `REMINDER_MAX_ATTEMPTS` | 5 | Retry cap before the heartbeat gives up on the invite. |
| `REMINDER_RETRY_BASE_MS` | 1m | Backoff base; doubles each attempt, capped at 30m. |

A confirmation `> floor` before the slot still gets a (shortened-notice)
reminder; a confirmation `≤ floor` suppresses the separate reminder and the
confirmation copy does not promise one. Each retry attempt is claimed
atomically (`claimReminderAttempt`) so a down comms provider cannot trigger a
re-claim/re-fail storm or a duplicate send; `reminder_sent_at` is set only on
success.

## 6. Legacy normalization

Pre-contract rows stored the HTTP code inline (e.g. `failed:500`).
`coerceOutboxStatus` (applied in `listOutbox`) maps any such value — and any
other unrecognized string — to the canonical enum, defaulting unknowns to
`failed` (safer to over-report a drop than mislabel one as `sent`/`queued`).
Locked by `comms-status.test.ts`.

## 7. Asynchronous bounce / delivery receipts

A relay's HTTP 2xx on send means "the relay accepted the POST," not "the
candidate received it." `POST /api/comms/callback` is where a configured
relay (SendGrid/Mailgun/Postmark/an ATS) reports bounce/complaint/drop/etc.
back, keyed by the message's `ref` + `kind`:

- **Auth is fail-closed.** Returns `503` unless `COMMS_CALLBACK_SECRET` is
  set; when set, every call must present it as the `x-comms-secret`
  **header** (not a `?secret=` query param — those get logged). Constant-time
  compare; an `x-comms-timestamp` must be within ±5 minutes; an in-process
  nonce guard drops an exact replay.
- **Public allow-list entry.** `/api/comms/callback` is on
  `app/_lib/auth/public-routes.ts` (same rationale as `/api/billing/webhook`)
  so the operator gate doesn't 401 the relay before the shared-secret check
  runs. The recruiter read (`/api/comms`) and resend stay gated.
- **Unmatched ("orphan") receipts are answered, not swallowed** —
  `{ recorded: false, reason: "no_matching_send", stored: true }`, still
  stored append-only, surfaced in the Comms Center as an actionable unmatched
  receipt.
- **Bounce-class outcomes** (`isBounceOutcome`) record an append-only
  `bounced` outbox receipt row. Positive/soft outcomes are accepted with
  `{ recorded: false }` (stops relay retries) but not yet surfaced.
- **The receipt supersedes the green `sent`.** `deriveCommsView`
  (`comms-view.ts`) folds a `bounced` receipt onto its originating `sent`
  row, flipping it to a red **bounced** badge and joining the dead-letter
  "needs attention" set; a later recovery mirrors this the other way. Locked
  by `comms-view.test.ts`.

## 8. One delivery truth, on every surface

- **Failure reason persisted.** `dev_outbox.failure_detail` (additive,
  nullable) carries the precise dead-letter detail (`http 503`, a DNS error, a
  timeout) — only for `failed` rows, so a stale reason from a retry that
  later succeeded can never sit next to a green badge.
- **`commsVerdict` is the single vocabulary** — one pure function
  (`comms-view.ts`) maps a derived row to exactly one of `orphaned | bounced |
  recovered | failed | sent | queued`; the Comms Center and the candidate
  drawer both consume it, never re-deriving.
- **The drawer payload carries the derived fields** via one exported mapping
  (`candidate-timeline.ts` → `toCandidateComm`); parity locked by
  `comms-delivery-truth.test.ts`.
- **Resend claims are honest** — both resend clients (Dev outbox
  `ResendButton`, Comms Center `BouncedResend`) surface the server's refusal
  reason and only report success when the fresh row itself isn't `failed`.

## Configuration summary

| Variable | Direction | Unset (honest default) | Set |
|---|---|---|---|
| `COMMS_WEBHOOK_URL` | outbound | local outbox only; every surface says messages aren't being sent | messages POST to the relay as `kp.comm.v1` (no HMAC) |
| *(Channels tab → Relay config)* | outbound | same as above until a URL is saved | stored URL + optional secret; HMAC-signed sends |
| `COMMS_CALLBACK_SECRET` | inbound receipts | `POST /api/comms/callback` answers `503` (fail-closed) | relay receipts accepted with header auth + timestamp + nonce guard |
| `EMAIL_INBOUND_DOMAIN` | inbound email | the Email intake wizard shows the HTTP receiver URL and says forwarding isn't wired | wizard hands out `<token>@<domain>`, routed to `POST /api/channels/inbound/<token>` |

## Surface

| Module | Purpose |
|---|---|
| `app/_lib/comms.ts` | Channel selection (`getCommsChannel`), `OutboxChannel`, `WebhookChannel` (retry + dead-letter + HMAC). |
| `app/_lib/comms-relay.ts` / `comms-relay-store.ts` | Relay resolution (env → stored config) and the encrypted stored-config persistence. |
| `app/_lib/comms-dispatch.ts` | Per-kind message builders, `candidateRecipient()`. |
| `app/_lib/comms-status.ts` | `OUTBOX_STATUSES`, `coerceOutboxStatus`, retry classification. |
| `app/_lib/comms-view.ts` | `deriveCommsView`, `commsVerdict` — the single delivery-truth vocabulary. |
| `app/_lib/comms-truth.ts` | `isRelayConfigured` legacy helper / capability surfacing. |
| `app/_lib/interview-reminder-policy.ts` | Reminder lead/floor/retry constants. |
| `app/api/comms/callback/route.ts` | Async bounce/delivery receipt intake. |
| `app/api/comms` | Recruiter read of the outbox / Comms Center. |
| `app/features/hiring/channels/**` (`ChannelsRelayConfigCard.tsx`, `ChannelsCommsTable.tsx`, `ChannelsCommsBouncedResend.tsx`) | Channels tab UI: relay config, Comms Center table, bounce resend. |

## Known gaps

- No durable retry queue — retries are inline/bounded within the request;
  `comms.log` is not yet shipped to an external alerting sink.
- Positive/soft bounce-callback outcomes (delivered/opened/deferred) are
  accepted but not yet surfaced as an engagement feed.
