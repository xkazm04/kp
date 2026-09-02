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

**The edge does not add a fourth status.** An install paired with an always-on
edge (§11) can have inbound events *held* remotely, but nothing about an
OUTBOUND message changes: it is still `queued`, `sent` or `failed` here, decided
here. What the edge introduces is a held state on the INBOUND side, and it lives
on the wire rather than in this vocabulary — the Worker answers `202
{result:"held"}` to a source, never `200 {result:"accepted"}`, because the
eligibility decision has not happened yet and an integrator's log must not read
as though a candidate was filed. A bounce receipt that arrives while the studio
is closed is likewise *held*, then recorded through the ordinary
`recordDeliveryReceipt` core the moment the clock drains it — the Comms Center
sees the same `bounced` row it would have seen live, only later.

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
  `ResendButton`, Comms Center `BouncedResend`) split the same **four** outcomes,
  because `POST /api/comms/[id]/resend` answers `200` for three of them: refused
  (non-2xx → the server's own reason, resolved from the machine `code`) ▸
  dead-lettered again (`failed`/`bounced`) ▸ **recorded but undeliverable
  (`queued` — no relay configured)** ▸ actually relayed (`sent`). Only the last
  may say "Resent". `queued` is the one that bit: the relay is a stored,
  UI-editable capability, so it can be gone by the time a recruiter chases a
  bounce raised while it was wired, and a corrected address that never leaves the
  building must not report green.

## 9. The adverse comm: recorded reasons only, protected attributes dropped

`dispatchRejection` (`comms-dispatch.ts`) appends a short feedback block built by
`app/_lib/rejection-feedback.ts` from the entry's **recorded** still-unmet checklist
items (`entryProfileGaps`) — never from a fresh LLM call, and never at all when nothing
was recorded (silence beats an invented rationale; the plain template ships instead).

- **Max 3 bullets**, each trimmed to 140 chars and de-duplicated case-insensitively.
- **Deny-by-default protected-attribute filter.** A line matching any pattern is dropped
  **whole** (a partially-scrubbed sentence about someone's age is still a sentence about
  their age) and `filtered` is raised so a recruiter can see the filter fired. A fully
  filtered gap list does **not** fall through to the derived unmet-requirement list —
  that would route around the filter.
- **The Czech patterns are stems with an open suffix under `/u`, not `\b…\b`.** JS's
  `\b` is ASCII-only, so a diacritic is not a word character: `\bpohlaví\b` could never
  match the word at all, and `\bvěk\b` matched only the bare nominative while "věku" /
  "věkové" shipped. Age and gender — the plainest discrimination claim an adverse comm
  can make — were the two Czech stems with no inflection tail. Locked by
  `rejection-feedback.test.ts` ("the Czech filter holds in EVERY inflection").

## 10. The candidate's language, and the links inside the letter

A candidate is written to in **their** language, never the recruiter's request
locale. `resolveCommsLocale` (`comms-locale.ts`) is the one authority:

1. the entry's stored `locale` — the explicit choice captured at apply;
2. else **the entry's OWN team** `workspaces.default_locale` (`cs` on the ČS seed);
3. else `DEFAULT_LOCALE`, only when even the workspace row is unreadable.

Step 2 is per-tenant, so every dispatcher resolves through
`comms-dispatch.candidateLocale`, which threads `entry.workspaceId` (entry-less
dispatchers thread their caller's `opts.workspaceId`). Omitting it read the
*default* team's `default_locale`, so once a second team sets its own language a
NULL-locale candidate filed into it was written to in the default team's language.
Locked by `comms-dispatch-locale.test.ts` ("falls back to ITS OWN team's default").

**Catalog composition.** The deterministic bodies live in the `comms.*` namespace
and render through a locale-pinned translator (`comms-translator.ts` →
`catalog-translator.ts`), so next-intl's compile-time key checking cannot see them.
next-intl returns the **key path** for a message it cannot find — a non-empty string
with no `{placeholder}` left in it — so a rendering-only test stays green on a
missing key: `dispatchApplicationReceived` rendered `ack.bodyEnrich` /
`ack.statusLine`, which exist in no locale, and a quick-apply lead's acknowledgement
arrived with the body `comms.ack.bodyEnrich`. The ack now composes the same
`comms.ack.*` key set `distribution.ts` uses (`subjectRole`/`subject` ▸ `greeting` ▸
`bodyRole`/`body` ▸ `signoff`), labelling its two links with the candidate-facing
`apply.trackStatus` / `apply.quick.enrich*` copy the apply page shows beside the same
links. `comms-dispatch.test.ts` now derives the key list **from the dispatcher source**
and asserts `t.has(key)` in **all four** locales, so neither a phantom key nor an
unpinned de/fr catalog can come back.

**Links.** The GDPR erasure footer is the only candidate link BUILT inside
`comms-dispatch.ts`; the offer letter and the offer reminder receive their link from the
caller and PIN it here (`pinLinkLocale`, beside the same `candidateLocale` resolution the
letter uses) — until 2026-09-01 the offer link was the one bare candidate door, so a Czech
letter opened an English accept/decline page. Locked by `offer-link-locale.test.ts`. The
erasure link is absolute (`candidateLinkBase` → `publicBaseUrl`, warning
loudly when nothing is configured) **and `?lang=`-pinned to the language the letter is
written in**, exactly like the status link that rides beside it — `proxy.ts` turns the
param into the `NEXT_LOCALE` cookie, and without it the page resolved from a cookie the
candidate does not have and then from `Accept-Language`, opening the erasure explainer
in a language they never chose. Locked by `comms-dispatch-links.test.ts`.

## 11. Inbound when the studio is off: pull sources and the always-on edge

_Design and the full ladder: `docs/concepts/local-first-edge.md`. What follows is
what is IMPLEMENTED._

kp is local-first: the database, the model keys and every decision live on the
operator's machine, and that machine is off most of the day. Every inbound channel
was PUSH-only, so a lead delivered at 22:00 was not late, it was **lost** — the
source retried into a dead socket and gave up. Two doors now close that, and
neither of them moves a decision off this machine.

### One receiver contract, three doors

The JSON-lead half of the receiver lives in `app/_lib/inbound-lead.ts`
(`ingestInboundLeadJson`, and `ingestInboundLeadByToken` for callers that hold a
token but no HTTP request). The live route
(`app/api/channels/inbound/[token]/route.ts`) keeps only what is genuinely HTTP —
the rate limiter, the body-size reader and the multipart/CV branch — and calls the
core for everything else. So a pushed, pulled and drained lead get the same KO
semantics, the same idempotency window, the same receipt/accepted stamps and the
same reply-halt, by construction rather than by discipline. Pinned by
`channels-receiver-contract.test.ts`.

### L0 — pull sources (no cloud, no account, no dependency)

A receiver row is now bidirectional. Set `pull_url` on it and the clock, on every
tick, asks that source what has arrived since the stored cursor and files it
through the core (`app/_lib/pull-pass.ts`, wired in `instrumentation-node.ts`
BEFORE the policy pass so a lead collected on wake is already visible to the same
tick's automation).

The contract an integrator implements:

```
GET <pull_url>[?since=<cursor>]        Authorization: Bearer <pull_secret>
200 { "events": [ { "id": "…", "payload": { …lead… } } ], "cursor": "…" }
```

`payload` is exactly the body that source would have POSTed to the receiver, so a
source that already speaks push speaks pull for free; a bare array of leads (no
envelope) is accepted as itself. `cursor` is opaque and source-owned. The source's
`id` becomes the idempotency key when present, else the payload bytes are hashed.

Rules that matter: the cursor advances **only on a clean pass** (a 5xx-class
failure re-asks the same window next tick rather than skipping it — the source is
the only thing that can replay it); a page is clamped to 50 events and 1 MB with a
15 s timeout; the URL is validated `https`-and-public at write AND at every pull
(the relay/ATS SSRF posture); a failure is recorded on the row as
`last_pull_error` and cleared by the next clean pull, never left sticky.

Configuration is API-only today: `PATCH /api/channels/webhooks`
`{token, pullUrl, pullSecret}` (team-scoped; secret semantics are the usual
omit-keeps / `""`-clears / string-replaces, encrypted at rest). There is no UI for
it yet — see Known gaps.

**IMAP is deliberately absent.** It needs a mail dependency and a MIME parser,
which is a dependency decision, not a code decision — and the edge's Email Routing
handler below answers the same need with none. A mail-to-JSON bridge that speaks
the contract above works today.

### L1 — the always-on edge

An optional ~250-line Cloudflare Worker (`edge/`, deployed to the operator's OWN
account, free tier) accepts webhooks, candidate mail and delivery receipts while
this install is off, holds them in an append-only log, and hands them over on the
next tick. `app/_lib/edge-drain.ts` is the local half.

What the edge is **not**: it holds no candidate database (the log is DELETED as it
drains), no provider keys, no session secrets — one shared HMAC secret whose whole
power is "may talk to this queue". Once the install publishes a sealing key
(Channels → Edge → Enable sealing, `POST /api/edge/pair`), it cannot read what it
stores either: bodies are AES-256-GCM sealed under a key wrapped to the install's
public RSA key (`app/_lib/edge-crypto.ts`), and the private half never leaves the
machine. The keypair is minted **once**: two "Enable sealing" clicks publish one
key, the loser re-reading the winner, because a second keypair would orphan
everything already sealed to the first. `edge_config` is a deployment-level table, exempt in `tenancy.ts` for the
same reason `comms_relay_config` is; the leads it produces are filed into the
workspace of the RECEIVER TOKEN they were addressed to, by the core.

The loop, and why the order is load-bearing:

| Step | Call | Why here |
|---|---|---|
| 1 | `GET /drain?since=&limit=` (signed) | events in sequence order |
| 2 | apply each through the same cores a live request uses | the decision stays local |
| 3 | `POST /ack {upto}` (signed) | **only after** applying — a crash between 2 and 3 replays harmlessly (idempotency key + email dedupe); a crash between 3 and 2 would lose a candidate silently |
| 4 | `POST /heartbeat` (signed) | presence; this is what keeps the nudge quiet |

A deterministic refusal (unknown token, closed role, no mappable email, a kind
this version does not understand) is **handled** and advances the cursor — a retry
would only reproduce it. Anything 5xx-class **holds**: the page stops at the last
good sequence and the operator gets a reason on the Channels card.

Signing is the relay/ATS scheme: `x-kp-timestamp` (epoch ms, ±5 min) plus
`x-kp-signature` = HMAC-SHA256 of `<timestamp>.<signed>`, where `<signed>` is the
body for a POST and the path+query for a GET. Both halves of that choice are
pinned across the two runtimes by `edge-drain.test.ts`.

**The nudge** — "your studio needs to run" — lives on the Worker's cron, not here,
for the obvious reason: the machine that is switched off cannot be the machine
that notices it is switched off. One nudge per quiet period (`nudged_at` is
cleared by the next heartbeat), carrying COUNTS, never names. `nudged_at` is
stamped **only after a 2xx** from the nudge target: a failed POST is logged with
its status and left unstamped, so the next cron tick tries again instead of the
backlog going quiet until the install happens to wake on its own.

**Mail is stored as headers only** (sender + subject). An emailed CV therefore
arrives as a *lead* whose acknowledgement carries the enrichment link, not as a
parsed candidate — carrying attachments would mean storing the body, which is the
one thing this design refuses to do.

`KP_OFFLINE=1` disables the edge entirely, ahead of any config: air-gapped means
air-gapped.

## Configuration summary

| Variable | Direction | Unset (honest default) | Set |
|---|---|---|---|
| `COMMS_WEBHOOK_URL` | outbound | local outbox only; every surface says messages aren't being sent | messages POST to the relay as `kp.comm.v1` (no HMAC) |
| *(Channels tab → Relay config)* | outbound | same as above until a URL is saved | stored URL + optional secret; HMAC-signed sends |
| `COMMS_CALLBACK_SECRET` | inbound receipts | `POST /api/comms/callback` answers `503` (fail-closed) | relay receipts accepted with header auth + timestamp + nonce guard |
| `EMAIL_INBOUND_DOMAIN` | inbound email | the Email intake wizard shows the HTTP receiver URL and says forwarding isn't wired | wizard hands out `<token>@<domain>`, routed to `POST /api/channels/inbound/<token>` |
| `KP_EDGE_URL` + `KP_EDGE_SECRET` | inbound (all kinds) | **inbound events reach this install only while it is running** — the honest local-first default; the Channels → Edge card says "Not paired" | the clock drains the edge every tick: webhooks, mail and bounce receipts that arrived while the studio was closed are filed on wake (§11) |
| *(Channels tab → Edge card)* | inbound | same as above until a URL is saved | stored URL + secret (encrypted at rest), env wins when both are set |
| `KP_NUDGE_TARGET` | inbound | the edge still holds and counts; it just never tells you | the edge POSTs "N events waiting" to this endpoint after a quiet period — counts, never names |

## Surface

| Module | Purpose |
|---|---|
| `app/_lib/comms.ts` | Channel selection (`getCommsChannel`), `OutboxChannel`, `WebhookChannel` (retry + dead-letter + HMAC). |
| `app/_lib/comms-relay.ts` / `comms-relay-store.ts` | Relay resolution (env → stored config) and the encrypted stored-config persistence. |
| `app/_lib/comms-dispatch.ts` | Per-kind message builders, `candidateRecipient()`. |
| `app/_lib/rejection-feedback.ts` | `buildRejectionFeedback` / `renderRejectionFeedback` — recorded-only rejection reasons behind the protected-attribute filter (§9). |
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
  own height only pushed the ledger down a second time. The one thing the usable
  form must **not** do while that read is unknown is save a blank URL:
  `setRelayConfig` has no "keep the stored URL" shape — an absent or empty `url`
  **disables** the relay — so a secret rotation typed on a failed read would have
  cleared a live endpoint and answered "Saved". Save is therefore held back for
  exactly the ambiguous case (config unknown *and* the field empty), the same
  "unknown ⇒ say nothing" rule the badge and the Test button already follow. A
  successful save then **re-reads** `GET /api/comms/relay` instead of patching the
  old state: the POST echoes the stored config but reports no `envConfigured`, and
  after a failed initial read there was no state to patch — which left the pending
  pill and a disabled Test button sitting over a relay just configured.
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
it had not read. The last site to collapse the distinction was the **Add-receiver
modal**: both panes handed it `jobs ?? []` and it branched on `length === 0` to
assert *"Publish a role first. Each receiver binds to one job."* plus a "Go to the
JD library" CTA — a **cause** the modal cannot know, shown to workspaces full of
published roles whenever the jobs read was in flight or had failed. It now takes
`ReceiverJob[] | null`, holds the picker's height while unknown, and preselects the
first role by derivation so a list that lands *after* the modal opened still fills
the picker.

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
- **`dispatchOutreach` reports `{ sent: true }` off "the call resolved", not off the
  outbox row's real status.** `sendCandidateComm` returns the status precisely so a
  caller can key its claim on it (REC-10), and the interview/schedule dispatchers do;
  outreach ignores it, so a relay dead-letter still records `outreach_sent` — the
  durable marker `automation-run` uses to refuse a retry ("already_sent") — for a
  message nobody received. Its refusal vocabulary is already unambiguous at the source
  (`anonymized | consent_expired | replied | manual`, so `suppressed_${reason}` is
  derivable); the collapse into "consent expired" happens in `automation-run.ts`'s
  ternary, which handles only `anonymized` and treats everything else as a consent
  lapse. Both halves want the same change: carry the delivery status in
  `OutreachResult` and map every reason 1:1 at the consumer.
- **Pull sources have no UI.** `PATCH /api/channels/webhooks` is the only way to
  set `pullUrl` / `pullSecret`; the receiver table shows neither the pull URL nor
  `last_pull_error`, so a source that has been failing for a week is visible only
  in the clock's log. The Edge card (§11) is the model for what this needs.
- **The edge cannot carry a CV.** Mail is headers-only by design, so an emailed
  attachment is not extracted — the candidate has to follow the enrichment link.
  Closing this means sealing the body at the edge and extracting locally on drain,
  which is a real feature, not a tweak.
- **Candidate-facing pages are still dark while the studio is off.** The edge
  answers for INBOUND events only; `schedule/[token]`, `status/[token]` and
  `apply/[id]` are unreachable when the machine is off. That is L2 in
  `docs/concepts/local-first-edge.md` (a signed projection the install publishes)
  and is not built.
- **One drain, one cursor, one machine.** Two installs draining the same edge would
  race on the cursor; a multi-operator deployment should run the runtime on one
  always-on host rather than pairing several laptops to one edge.
- No durable retry queue — retries are inline/bounded within the request;
  `comms.log` is not yet shipped to an external alerting sink.
- Positive/soft bounce-callback outcomes (delivered/opened/deferred) are
  accepted but not yet surfaced as an engagement feed.
