# Outbound Candidate Comms

Every candidate-facing message the pipeline sends — intake acknowledgements,
outreach, rejections, offers, interview confirmations/reminders —
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

**Tenancy: `ref` is the tenant source, on the row AND on the wire.** A
message's owning team is derived from the referenced pipeline entry —
`recordOutbox` does it via `outboxWorkspaceForRef`, and `WebhookChannel`'s
envelope enrichment now does it the same way
(`getPipelineEntry(ref, getEntryWorkspace(ref))`). `OutboundMessage.workspaceId`
is only the fallback for an *entry-less* comm (the KO decline) and almost no
dispatcher threads it, so scoping the envelope lookup to it fell back to the
default team: on any other workspace the lookup missed and every relayed
message shipped with `candidate`/`job`/`stage` null, leaving the receiving ATS
unable to map it back to a person. Locked by `comms-tenancy.test.ts`.

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
- **The nonce is a claim, not a stamp.** It is recorded before the receipt is
  written and RELEASED (`ReplayGuard.release`) if that write throws, so the
  relay's retry of a receipt we failed to store is processed instead of being
  answered `duplicate: true` — the same rule `webhook-idempotency.ts` states
  for the inbound receiver: idempotency only persists for work that succeeded.
  Otherwise one locked-DB moment silently swallowed a bounce and left a green
  `sent` standing on an undeliverable message. Locked by
  `app/api/comms/callback/callback-auth.test.ts`.
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
- **Attribution is per-receipt, indexed by the target SEND.** A receipt
  carries only `(ref, kind)`, so `pickBounceTarget` binds each one to the
  newest send at or before it — never fanned out over every earlier send.
  The index is keyed by that target send's id, not by `(ref, kind)`: keying
  on the pair kept only the newest receipt per pair, so when an offer bounced
  and its corrected resend bounced too, the first receipt was folded away
  without ever marking its send and the undeliverable first offer kept a
  green `sent` on every surface. Two receipts landing on the *same* send keep
  the newest detail. Locked by `comms-view.bounce.test.ts`.

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
| `app/api/channels/webhooks` | Recruiter console: list / mint / revoke inbound receivers. Minting resolves the target role with the unscoped by-id `getJob` and therefore gates it on `jobVisibleToWorkspace` — the shared seeded corpus plus the caller's own openings, exactly what the picker offers — answering `404` otherwise, so a receiver can't be bound to another team's authored role (whose title the receivers list would then render). Guarded by `channels-receiver-contract.test.ts`. |
| `app/api/channels/inbound/[token]` | The PUBLIC token-authed lead receiver (JSON lead or multipart CV). |
| `app/features/hiring/channels/**` (`ChannelsRelayConfigCard.tsx`, `ChannelsCommsTable.tsx`, `ChannelsCommsBouncedResend.tsx`) | Channels tab UI: relay config, Comms Center table, bounce resend. |
| `app/features/hiring/channels/_components/table/TablePager.tsx` | `TABLE_PAGE_SIZE` (20) + `TablePager`/`clampPage` — the one pager every Channels table uses. |

## Channels tab: paging and the render cascade

**Every table pages in 20s.** `_components/table/TablePager` is shared by the Comms ledger
and the email/ad-form receiver tables. It replaced the ledger's "Show more"
button, which appended another 40 rows to the same list until the column filters
(which live in the table header) had scrolled far out of reach. Paging is a pure
client-side slice — the comms read is already capped at 200 rows server-side — and
the page index is **clamped**, never reset from an effect, so filtering down to
fewer pages lands the reader on one that exists. Any filter change returns to page
one. The pager renders nothing when everything fits on one page.

**Chrome renders before data; only data waits.** Two cascade gaps on the Comms
section are closed:

- `RelayConfigCard` used to render *nothing at all* — an empty reserved-height box
  — until `GET /api/comms/relay` answered, and a failed or operator-denied read
  left it null forever, so the editor silently ceased to exist. Now the card, its
  fields and its buttons paint on the first frame; only the on/off badge, the
  secret badge and the env-override note wait for the read, and the URL field
  refuses to be overwritten by a late response once someone has typed in it. It is
  no longer wrapped in `<Defer>` either — deferring a card that already holds its
  own height only pushed the ledger down a second time.
- `CommsTable` held back the caption, the column headers and the filters inside
  them behind the same fetch, although all three depend on nothing but client
  state. They now render immediately with a quiet reserved-height body.

The status vocabulary stays honest through this: `relayConfigured` seeds `true`,
so a read in flight never accuses a configured relay of dropping mail, and the
section's own status badge keeps its pending pill rather than guessing a default.

**The tab owns the shared lists; the panes don't re-fetch them.** `useChannelData`
loads the receivers and the published jobs once, and `ChannelsTabStage` hands both
to the Email-intake and Ad-forms panes. `useChannelsReceivers` no longer fetches at
all — it derives its channel's slice and owns only revoke. It used to re-request
`/api/channels/webhooks` **and** `/api/jobs?limit=200` on mount, i.e. ~202 KB
re-downloaded on every switch into those panes (the jobs list alone measures
201 KB), and it made the same two lists exist twice, so a revoke refreshed one copy
and left the other's counts stale.

**A failed load is not an empty channel.** `useChannelData` has four states per
source, not three: in flight (`null`), settled, empty, and **failed**. Every branch
used to end in `?? []` / `?? 0`, and neither list fetch checked `r.ok` — so a 500
from `/api/jobs` (its own corrupt-seed guard answers one) or a `401` after the
session lapsed parsed as JSON, never reached the `.catch`, and settled the tab on a
confident empty: `Off`, `Nothing published`, `Receivers 0 / Received 0 / Leads 0`,
and the first-run intake brief telling a recruiter with live receivers how to set
one up. Now `listFromPayload` accepts a list only from a 2xx body that actually
carries one, a failure keeps the last known value (or `null`) and raises
`loadFailed`, and the tab renders the shared `resilience` error strip with a retry
instead of narrating a workspace nobody has read. The stat cluster renders `—` for
an unread receiver list — it was the third render site of `webhooks ?? []` and the
one that still printed a hard `0` next to a status badge honestly holding its
pending pill — and "Receive a test application" stays disabled until the jobs list
settles, because it fires at `jobs[0]` and answered "Create a job first" over a list
it had not read.

**Careers links list only roles that can actually be applied to.** The jobs read
passes `openOnly=1` (`isJobOpenForApplications`: `NULL`/`published`). Unfiltered, it
also returned drafts and closed roles, which the pane rendered under the
`Published roles` stat with a copyable *apply link* — `/apply/[id]` 404s a draft and
answers "this role is closed" for a retired one, so the pane was minting dead links
for job posts, and the Add-receiver picker offered binding an inbox to them.

**"Waiting" follows the board's entry ROLE, not the name `Accepted`.** The stage
axis is per-workspace data (`pipeline-axis.ts`) and intake files arrivals through
`stageWithRole("entry", …)` (`cv-intake.ts`), so a team that composed its own board
in Settings → Hiring parked every inbound application in a column the tab's
`stage === "Accepted"` filter could not see — reporting `0 waiting` while they piled
up. `countWaitingAtEntry` resolves the entry column from the axis `/api/pipeline`
already returns alongside the entries. Both rules are pinned by
`app/features/hiring/channels/useChannelsData.test.ts`.

## Known gaps

- Column-filter option lists sort with `Intl.Collator` on the active locale, but
  the free-text Name filter still matches literally — searching `kralova` will not
  find `Králová`.
- **`/api/jobs?limit=200` ships 201 KB for a list the Channels tab reads two fields
  of** (`{id, title}`, for the careers links and the receiver-binding picker). It
  is the largest payload on the tab by an order of magnitude. A `?fields=` (or
  count/summary) projection on that route would cut ~195 KB per Channels visit;
  the endpoint is shared with other tabs, so the projection has to be additive.
- **`useChannelData` downloads the whole board (`/api/pipeline`, 45.7 KB) to compute
  one number** — active entries at the axis's entry column, for the "waiting" stat
  (the payload's `stages` is what resolves that column). `/api/attention`
  already computes exactly that cohort as its `channels` count in 0.1 KB and the shell
  fetches it on every tab — but it is not workspace-scoped yet (see below), so it
  cannot be the source for this stat until that is fixed.

- **The inbound receiver's multipart branch has no pre-parse byte cap.** The JSON
  branch treats `content-length` as advisory and enforces the real 64 KB budget on
  the bytes read off the wire (`readTextWithLimit`); the CV branch only fast-rejects
  on the header and then calls `request.formData()`, so a chunked upload that
  declares no length is buffered whole before `validateUploadServer` ever sees a
  size. Same shape as `/api/analyze` and the public `/api/extract-text`, so the fix
  is a shared streaming-multipart cap, not a per-route patch.
- No durable retry queue — retries are inline/bounded within the request;
  `comms.log` is not yet shipped to an external alerting sink.
- Positive/soft bounce-callback outcomes (delivered/opened/deferred) are
  accepted but not yet surfaced as an engagement feed.
