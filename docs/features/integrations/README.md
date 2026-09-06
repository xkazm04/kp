# Integrations — Google Calendar, ATS connections, ATS write-back

The credential surface for the outside systems kp talks to. Three integrations live here,
all optional, all degrading to the app's keyless behaviour when they are not configured:

- **Google Calendar** — free/busy lookups so a proposed interview slot is one the
  interviewer can actually make, plus the event write-back for a confirmed interview.
- **ATS connections (inbound)** — per-provider API credentials for reading applications
  out of an applicant tracking system (Recruitee, Recruitis, Teamio).
- **ATS/HRIS write-back (outbound)** — the signed `kp.ats.v1` webhook that mirrors hiring
  outcomes into a system of record.

Inbound and outbound are the two halves of one ATS seam, so they sit together here. The
outbound panel used to live on the Background-tasks tab, which is where the operator-only
surfaces had collected; it moved because an operator asking "what can this connect to"
looks at Settings → Integrations. The *engine* behind it (envelope, signing, delivery) is
still documented in [../comms/outbound-export.md](../comms/outbound-export.md) — only the
door is here.

## Entry point

**Workspace → Settings → Integrations** (`?tab=integrations`,
`app/features/settings/integrations/IntegrationsTab.tsx`). Operator-gated in the same
sense as the routes it calls: every endpoint behind this tab runs `requireOperator()`, and
in open mode (no `KP_OPERATOR_PASSWORD`) it stays open for local dev.

The tab is also the **landing target of the Google OAuth callback** — the callback route
redirects to `/?tab=integrations&calendar=<code>` and the calendar panel renders that code
as a banner, then strips the param from the URL so a reload cannot replay a stale outcome.

## Google Calendar

### Flow

1. **Connect** is a plain link to `GET /api/calendar/google/start`, not a fetch: that route
   sets an httpOnly CSRF state cookie (32 random bytes, 10-minute TTL) and 302s to Google's
   consent screen, which only a top-level navigation can follow.
2. Google returns to `GET /api/calendar/google/callback`, which compares the state with
   `timingSafeEqual`, exchanges the code, and stores the grant. The state is **one-shot**:
   the callback expires the cookie whatever the outcome, deleting it at the same
   `OAUTH_STATE_COOKIE_PATH` it was set at — a cookie is keyed by (name, path), and a
   pathless delete serializes `Path=/`, which expires nothing and leaves the real state
   replayable for the rest of its TTL (`callback/route.test.ts` guards both halves).
3. Whatever happens, the operator lands back on this tab with a `calendar=<code>` param.
4. **Disconnect** issues `DELETE /api/calendar/google`, which **revokes at Google first**
   and only then drops the row — deleting locally without revoking would leave a live grant
   nobody can see or withdraw from kp. The response reports `revokedAtGoogle` separately,
   and the UI says so when the revoke did not confirm.

### Scopes, and partial grants

kp requests exactly two narrow scopes (`app/_lib/calendar/google-oauth.ts`):
`calendar.freebusy` (busy intervals only — no titles, attendees or locations) and
`calendar.events` (write the interview). Google lets a user untick either one on the
consent screen, which yields a "successful" connection that silently cannot do half its
job. `missingScopes()` computes the shortfall, `saveCalendarConnection` stores it, and the
calendar panel renders it as an amber *Partial access granted* block with a Reconnect
action. The callback distinguishes this case with its own status code
(`connected_partial`).

A grant with **no refresh token** is refused outright rather than stored: it would expire
within the hour and present as "it worked, then stopped working tomorrow".

### The nine callback outcomes

`app/_lib/calendar/callback-status.ts` is the canonical list —
`CALENDAR_CALLBACK_STATUSES` — and the callback route's redirect helper is typed against
it, so a new outcome is a compile error until it is added. Every code has a title + a
what-to-do line in all four locales, and
`app/features/settings/integrations/integrationsCatalog.test.ts` asserts that mapping by
**set equality** in every locale. (`npm run i18n:check` cannot catch a gap here: four
identically-incomplete catalogs are in perfect parity with each other.)

| Code | Tone | Meaning |
| --- | --- | --- |
| `connected` | ok | Full grant stored |
| `connected_partial` | warn | Stored, but a scope was unticked |
| `cancelled` | warn | User pressed Cancel on Google's screen |
| `google_error` | error | Google returned an error other than `access_denied` |
| `state_mismatch` | error | Forged callback, or the consent screen sat past the state TTL |
| `no_code` | error | Callback carried no authorization code |
| `not_configured` | error | OAuth client env vars vanished mid-flow |
| `no_refresh_token` | error | Google withheld the refresh token — deliberately not stored |
| `exchange_failed` | error | The code→token exchange threw |

An unrecognized code still renders (generic error copy plus the raw value) rather than a
blank banner.

### Without credentials

With no `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`, `googleOAuthConfig()`
returns null and the panel renders a *Not configured on this deployment* block naming the
two variables and the exact redirect URI to register in Google Cloud — no Connect button
that would bounce off the start route's 503. **Scheduling keeps working:**
`proposeFreeSlots` (`app/_lib/calendar/available-slots.ts`) falls back to
`proposeSlots`'s local arithmetic and reports `calendarChecked: false`, so a caller never
claims a slot was calendar-confirmed when nothing was checked.

### When Google hangs, or the at-rest key moves

Two failure modes reach a **public** path — a free/busy lookup runs inside
`GET /api/schedule/<token>`, the candidate's own booking page — so neither may throw and
neither may block:

- **Every outbound Google call is bounded at 8s.** `TIMEOUT_MS` in `google-calendar.ts`
  covers the Calendar API; `OAUTH_TIMEOUT_MS` in `google-oauth.ts` covers the token
  endpoint and the revoke, which the Calendar calls sit *behind* (a free/busy lookup
  refreshes the access token first). Without the second bound a blackholed
  `oauth2.googleapis.com` left undici's 300s header timeout as the only limit on a
  candidate's booking page, and on the operator's Disconnect button. A timeout surfaces as
  a `GoogleOAuthError` and degrades to the unchecked slot list.
- **A token that no longer decrypts is treated as absent, not as an exception.** The
  grant is AES-256-GCM ciphertext keyed on `KP_ATS_SECRET_KEY` (falling back to
  `KP_SECRET`), so rotating either — or setting the dedicated key on an install that had
  been using the fallback — makes the stored token unreadable. `readStoredToken` in
  `google-calendar.ts` catches that, logs which env var to look at, and returns `null`, so
  scheduling degrades to `calendarStatus: "unavailable"` (kp *does* still hold a grant, it
  just cannot use it) instead of 500-ing the candidate's page. `DELETE
  /api/calendar/google` tolerates the same failure and still drops the row, reporting
  `revokedAtGoogle: false` — otherwise the operator would be trapped with a connection they
  could neither use nor remove. Guarded by `app/_lib/calendar/google-calendar.test.ts`.
- **A planned rotation no longer breaks anything.** `ats-secret.ts` reads through a retired
  key (`KP_ATS_SECRET_KEY_PREVIOUS`, falling back to `KP_SECRET_PREVIOUS` on a
  single-secret install) exactly as `llm-secret.ts` does for provider keys, so a deployment
  that has just rotated stays readable instead of going dark until `npm run secrets:rotate`
  has run. Encryption ALWAYS uses the current key, and `reencryptAtsSecret` lets a store
  heal a row on its next write — `setAtsConnection` does that for a preserved ATS token,
  best-effort: a value neither key opens is left exactly as stored, because rewriting a row
  we cannot read would destroy the only copy of the credential. Unset the `*_PREVIOUS` var
  once the rotation reports zero rows left. Pinned by `app/_lib/ats-secret-at-rest.test.ts`.

## ATS connections (inbound)

One connection per provider — `ATS_PROVIDERS = ["recruitee", "recruitis", "teamio"]`, an
allowlist because `provider` namespaces every external id in `ats_links`. Each carries a
base URL, an API token and a field map.

- **Base URL** is validated through `assertPublicHttpsEndpoint` (https only, no IP
  literals or internal hosts) — kp sends an authenticated request there, so an SSRF-able
  base URL would hand the credential to a metadata service. The host is compared in its
  **dot-stripped** form: `https://localhost./` and `https://metadata.google.internal./`
  are the fully-qualified spelling of the same names (every resolver answers them
  identically), but `new URL()` keeps the trailing dot on a DNS host — it normalizes it
  away only for an IPv4 literal — so without that normalization one extra character
  walked straight past the internal/loopback rule. Locked by
  `app/_lib/safe-url.test.ts`.
- **Token** is write-only end to end: encrypted at rest (AES-256-GCM, `ats-secret.ts`),
  never returned by `GET` (`hasToken` only). Leaving the field blank on an edit keeps the
  stored token; the form never sends `apiToken: ""`, which the store reads as *clear*.
- **Every field is a partial update** (`setAtsConnection`: an omitted key keeps what is
  stored), and the panel sends only what the operator touched. That covers `baseUrl` too:
  it is prefilled so it can be edited in place, but resent **only when it differs** from
  the loaded value, so a save that just parks a connection (`enabled: false`) cannot revert
  an endpoint another session changed since this tab loaded, and cannot re-run the SSRF
  check on a URL the store already vetted. Blanking the field still sends an explicit
  `null`, which clears it. After a successful save the form adopts the store's
  parse-normalized URL, so the next save compares against what is really stored.
- **Two tabs cannot clobber each other.** `GET` returns `connection.version`; the panel
  echoes it back as `expectedVersion`, and `setAtsConnection` re-asserts it inside an
  IMMEDIATE transaction before writing. A save composed against a connection someone else
  has since replaced is refused whole — `ATS_CONNECTION_STALE`, 409, with the CURRENT
  connection in the body — and the panel re-reads and re-prefills rather than reverting
  the other tab's field map. Same contract as `ats_config` next door. `expectedVersion` is
  optional, for server-internal writes with no read to be stale about.
- **Every refusal is a code, not a sentence.** `ATS_CONNECTION_PROVIDER_UNKNOWN`,
  `ATS_CONNECTION_BASE_URL_INVALID`, `ATS_CONNECTION_TOKEN_INVALID`,
  `ATS_FIELD_MAP_INVALID` (400), `ATS_CONNECTION_NOT_FOUND` (404),
  `ATS_CONNECTION_STALE` (409), `PAYLOAD_TOO_LARGE` (413) and the two store codes
  `ATS_CONNECTION_{SAVE,REMOVE}_FAILED` (500). `AtsConnectionError` and `AtsFieldMapError`
  carry the code; the route maps it and logs the English message. The panel resolves it
  through `useErrorMessage`, so a Czech operator no longer reads canonical English.
- **Bodies are capped**: 32 KB on `POST /api/ats/connections`, 16 KB on
  `POST /api/ats/config`, measured on the bytes read off the wire (`readJsonWithLimit`) —
  `content-length` is advisory. Over the cap answers 413 with `maxBytes`.
- **Removal** asks the links question out loud. Forgetting the external-id links makes the
  next sync re-import every application as new (duplicating the pipeline); keeping them
  re-adopts bindings to records that may since have been erased. Neither is a safe default,
  so the confirm step carries an unticked checkbox matching the route's `forgetLinks` opt-in
  and the result reports how many links were dropped. The drop is **installation-wide**:
  `ats_connections` is keyed by provider alone while `ats_links` is per-tenant, so a
  workspace-scoped drop left every other team bound to a provider whose credential no
  longer exists (`deleteAtsLinksForProviderEverywhere`).
- **Enabled** parks a connection without deleting its credentials or its links.

The field map (`app/_lib/ats/field-map.ts`) is *not* editable from this tab yet — see
Known gaps.

## ATS / HRIS write-back (outbound)

The mirror image of the section above: a single signed webhook that POSTs a normalized,
versioned candidate record (`kp.ats.v1`) to a system of record when a subscribed hiring
outcome fires. Configured through `POST /api/ats/config`; `IntegrationsWebhookPanel`
renders the endpoint, the signing secret, the four subscribable events
(`candidate.hired`, `candidate.rejected`, `offer.accepted`, `offer.declined`) and a test
ping (`POST /api/ats/test`).

- **All four subscribable events actually fire.** Until this pass `dispatchAtsEvent` had one
  call site in the tree — the hire — so three of the four checkboxes were subscriptions
  nothing could ever deliver, and a connector built on the vocabulary kp publishes saw half
  the funnel and kept rejected candidates open. The emit sites now are: `candidate.hired`
  and `offer.accepted` on the candidate's accept (`offer-finalize.ts`; the hire is
  conditional on the entry CROSSING onto the terminal stage, the offer response is not —
  they are different facts), `offer.declined` on a decline that actually transitioned the
  entry (a decline on a stale link that demotes nobody mirrors nothing, exactly as it
  stamps no timeline event), and `candidate.rejected` beside the rejection comm in
  `pipeline-entry-action.ts`. Pinned by `app/_lib/ats-lifecycle-events.test.ts`.
- **The consent gate is in the record builder, not behind one door.** `buildAtsRecord`
  REFUSES an anonymized entry (`AtsRecordRefusedError` → the delivery is dead-lettered on
  the spot: an erased candidate does not become mirrorable by waiting) and, when
  `consentWithholdsPii` says the retention window has lapsed, masks the label, drops the
  contact and sets `candidate.piiWithheld: true` so a receiver can tell a redacted record
  from a sparse one. Both read the shared predicates in `consent.ts`, so the push door
  cannot drift from the pull door and every future egress path inherits the gate.
- **A retry is the same request, not a new one.** Every attempt carries the ledger row id as
  `Idempotency-Key` and re-sends a byte-identical body (see the receiver contract below),
  and the retry sweep CLAIMS each due row with a compare-and-swap on `(status, attempts)`
  before delivering — an operator pressing Retry while a cron POSTs the same route used to
  send the hire twice. `finalizeAtsDelivery` re-asserts the attempt count it read in the
  UPDATE's `WHERE` for the same reason.
- **The ledger is pruned.** Terminal rows — delivered, or dead-lettered with no retry
  scheduled — are dropped after `DELIVERY_RETENTION_DAYS` (90) by a sweep on the
  instrumentation clock. A still-scheduled failure is live work and is never swept, however
  old. The table had no DELETE anywhere in the tree before this, and every row names a
  candidate's pipeline entry.
- **The secret is write-only**, same contract as the inbound token: `GET` returns
  `hasSecret` only, and an untouched field leaves the stored secret in place. When set,
  deliveries carry an HMAC-SHA256 `X-Kp-Signature`.
- **An empty URL disables delivery** rather than queuing undeliverable events.
- **Every field is a partial update, and the document carries a version.** `setAtsConfig`
  keeps what it is not told about (`webhookUrl` / `events` / `webhookSecret` omitted =
  keep; `""` or `null` = clear), so a save that only changes the endpoint no longer
  rewrites the event subscriptions. That was the actual failure: the save was a
  whole-document write of a snapshot taken when the tab loaded, so two operators editing
  side by side silently dropped each other's subscriptions — while the inbound ATS panel
  right next to it already sent partials. On top of that, `ats_config.version` is bumped
  on every accepted write and rides on the public view; the panel echoes the version it
  read as `expectedVersion`, and the store re-asserts it inside an IMMEDIATE transaction.
  A save composed against a config someone else has since replaced is refused —
  `409 ATS_CONFIG_STALE`, nothing written, the *current* config returned beside the code so
  the panel can offer "reload what's stored" and let the operator re-apply against it
  rather than retry the same body one round later. Same doctrine, same shape, as
  `comms-relay-store.ts` and the decision-config store. Pinned by
  `app/_lib/ats-config-version.test.ts`.
- **The config 500 answers a code, never the thrown message.** A better-sqlite3 constraint,
  the absolute db path, or an at-rest crypto failure naming the key env var used to be
  forwarded verbatim; it is now `safeJsonError(…, "ATS_CONFIG_SAVE_FAILED")` — the detail
  goes to the server log, the panel renders the localized message.
- **Both network doors are throttled per IP.** `POST /api/ats/test` fires a server-side
  POST at an operator-set URL (20/10min, key `ats-test:<ip>`) and `GET
  /api/calendar/google/start` mints a state cookie and redirects a browser into Google's
  consent screen (30/10min, key `gcal-oauth-start:<ip>`). Both sat behind nothing but the
  operator gate, which open mode (`KP_OPERATOR_PASSWORD` unset) makes a documented no-op
  for the whole API — so unthrottled, the ping was an amplifier and a reachability oracle
  aimed at whatever host the config names (the SSRF guard vets the *address*, not the
  *rate*), and the OAuth start was cookie churn plus unattributed traffic at Google from
  this deployment's address. Each limiter sits *after* the operator gate (a rejected caller
  spends no budget) and *before* the expensive work. Pinned in
  `app/api/rate-limit-contract.test.ts`.
- **Every team's outcomes mirror through this one endpoint.** `ats_config` and the
  `ats_delivery` ledger are org-level by design (`app/_lib/tenancy.ts`): one deployment-wide
  mirror of every tenant, not one webhook per hiring team. The *record* behind an event is
  still built tenant-scoped, so `dispatchAtsEvent` takes the caller's workspace and falls back
  to the entry's owning workspace (`getEntryWorkspace`) when the caller holds none; the retry
  sweep re-derives it the same way, because a ledger row carries no tenant column. Both reads
  used to be unscoped — they resolved against the default workspace, so `candidate.hired` never
  fired for any other team and left no trace that it hadn't.
- **Nothing exits without a ledger row.** A dispatch opens its `ats_delivery` row *before* the
  record is built, so an entry that cannot be resolved — or a build that throws — becomes a
  `failed`, retryable, operator-visible row that says why, never a silent return. A hire that
  cannot be mirrored must not also be invisible.
- **Redirects are not followed** (`redirect: "manual"`). The SSRF guard resolves and vets only
  the host kp dials; with the default follow behaviour a vetted public endpoint answering
  `302 Location: http://169.254.169.254/…` (or a 307 to a loopback port, which replays the
  method *and* the signed PII body) would put that request into the internal network with no
  re-vetting, and hand `/api/ats/test` a port-scan oracle. A 3xx is reported as a delivery
  failure telling the operator to configure the final https endpoint.
- **The test ping tests what is *stored*, not what is typed.** `POST /api/ats/test` has no
  body — it pings the saved endpoint with the saved secret — so the button is disabled
  until the field matches the URL the server last confirmed, and editing the field retires
  the previous result. Otherwise a ping against the *previous* endpoint would report
  "Delivered: endpoint responded 200" under the new address the operator had just typed.
- **A failed config load says so — and disables Save.** The panel reads the HTTP status,
  not just the body: a 401 (expired or non-operator session) carries a parseable JSON body,
  so treating "no `config` in the answer" as a failure is what keeps a blank endpoint field
  and a "· not set" secret badge from being rendered over a configured deployment. Saying
  so was only half the guard, though: the toast scrolls away and Save stayed live over the
  blank form. The save is a partial now, but the diff it sends is computed against what
  the server last confirmed — which a form that never loaded holds as blanks, so every
  field would read as "the operator cleared it", and an empty URL is a legitimate "disable
  delivery". Save is gated on the config having actually been read back, with the reason
  held on screen beside the button rather than in a toast; the same gate is what supplies
  the `expectedVersion` a save echoes.
- **A failed outcome announces itself as one.** Every result line on this tab uses
  `role={ok ? "status" : "alert"}` with a failure tone — the convention
  `IntegrationsAtsForm` and `IntegrationsCallbackBanner` already followed and the calendar,
  Personas and webhook panels did not. The webhook ping was the sharp case: "Not delivered:
  connection refused" rendered in the same neutral grey, under the same polite role, as
  "Delivered: endpoint responded 200" — on the panel whose whole design is about never
  reporting proof a ping did not earn.
- **The machine identifiers come from their authorities, or are pinned to them.** The
  payload version is imported (`ATS_SCHEMA_VERSION`, app/_lib/ats-record.ts — pure and
  dependency-free by design), so the bump its own comment asks for cannot leave the
  settings page naming `kp.ats.v1` while the payloads say v2. The rest live in
  `integrationsWebhookIdentifiers.ts` because app/_lib/ats-webhook.ts pulls `node:crypto`
  and a client component cannot import it: the checkbox event ids are set-equality asserted
  against `SUBSCRIBABLE_EVENTS`, the displayed `X-Kp-Signature` against the signer's own
  header, and the pull endpoint against the route directory that must exist to serve it.
  The event ids are the sharp one — `ats-config-store.ts` validates a save against that
  vocabulary, so a drifted checkbox is a 400 on submit, not a cosmetic label.
- **Timestamps render in the READER's locale**, not the browser's. All three dates this
  tab shows — the ATS connection's `updatedAt`, the calendar's `connectedAt`, the Personas
  bridge's `lastOkAt` — went through a bare `toLocaleString()`/`toLocaleDateString()`,
  which follows the OS: a Czech operator on an en-US machine read `3/4/2026` inside a Czech
  sentence with no way to tell 3 April from 4 March. They resolve through `useFormatter()`
  now, the same idiom as `ProfileRosterRow` and the billing panels.
- **The `Send test` gate is a pinned rule, not an expression.** `webhookTestable(savedUrl,
  url)` (`integrationsWebhookGate.ts`) lives outside the component and is asserted by
  `integrationsLogic.test.ts`, because a rule of that shape loosens quietly during an
  unrelated edit — and the loosened version reports the *previous* endpoint's 200 under
  the address on screen.
- **The panel states its own ceiling**: this is vendor-neutral egress, not a certified
  Workday/Greenhouse/Lever connector — point a connector or an iPaaS at it. Only
  `candidate.hired` fires live today (on offer-accept); the other three are reserved for
  their lifecycle hooks, and the UI says so.
- **Pull works too**: `GET /api/ats/candidate/<entryId>` returns the same record on demand —
  operator-gated, scoped to the caller's workspace, and every successful export is audited
  onto that candidate's own pipeline-event timeline (`ats_export`).
- **The pull door honours the consent gate.** The gate lives in the record builder
  (`buildAtsRecord`, `app/_lib/ats-record.ts`, through the shared `consent.ts` predicates), so
  every export path applies it. An entry whose retention window has lapsed exports with its
  label masked to `First L.`, `contact: null` and `piiWithheld: true`, while keeping the
  non-identifying retained record (stage, status, match score, archetype, sealed decision)
  so a connector's stage sync still works; the audit detail records that the identity was
  withheld (`consent-redacted`). An entry that is already ANONYMIZED is refused, not
  redacted: the route answers `ATS_CANDIDATE_ERASED` (410) and a ledger delivery is
  dead-lettered. `anonymizeExpiredConsents` is a periodic best-effort sweep, so this
  read-time gate is the enforcement, not an optimization.

### Receiver contract

What a receiver must implement to accept a delivery from kp, and what it may rely on.

| Header | Value |
| --- | --- |
| `X-Kp-Event` | the event id (`candidate.hired`, …, or `ping` for the test delivery) |
| `X-Kp-Timestamp` | the ISO-8601 instant **this attempt** was signed. Re-stamped on every attempt; equal to the envelope's `sentAt` on the first one only |
| `X-Kp-Signature` | `sha256=<hex>`, present only when a signing secret is configured |
| `Idempotency-Key` | the delivery-ledger row id — constant across every attempt of one delivery, absent on the test ping. Also in the body as `idempotencyKey` |

**Verification, in order** (`verifyWebhookSignature` in `app/_lib/ats-webhook.ts` is the
reference implementation — port it, or read it as the spec):

1. Reject the delivery unless `X-Kp-Timestamp` parses and sits within **300 seconds**
   (`SIGNATURE_TOLERANCE_SECONDS`) of your clock, in **either** direction. Symmetric on
   purpose: a receiver whose clock runs ahead must not reject a correct sender, and "the
   future" is not a safer direction than "the past". The window covers honest skew plus
   flight time and stays far under the retry ladder's reach (6 attempts, exponential from
   one minute), so a legitimate retry re-signs rather than arriving stale.
2. Compute `HMAC-SHA256(secret, "<X-Kp-Timestamp>.<raw body>")` over the **raw request
   body bytes**, never a re-serialization, and compare it to `X-Kp-Signature` in constant
   time.

3. **Dedupe on `Idempotency-Key`** and answer a repeat with the original outcome. An
   attempt that timed out or lost its connection MAY already have been accepted by you;
   from kp's side that is indistinguishable from never arriving, so the ladder retries and
   your ATS gains a second hire for the same candidate unless you settle it. The key is the
   delivery-ledger row id: one row per (event, entry) attempt-set, constant across all six
   attempts, and it rides inside the signed body as `idempotencyKey` so you can verify it
   rather than trust the header. Same contract the candidate-comms relay's `messageId`
   already carried (../comms/outbound-export.md §1).

**Why `sentAt` and `X-Kp-Timestamp` are two fields.** `sentAt` is when the DELIVERY was
created and never moves, so a redelivery of unchanged data is byte-identical and a receiver
can dedupe on the body alone. The header is when THIS attempt was signed. Freezing the
signed instant as well would put every retry past minute five outside the tolerance above —
the ladder would be signing deliveries no correct receiver could accept. Same split as
Stripe's (`created` in the body, `t=` in the signature).

**Why the timestamp is in the signed input and not merely beside it.** The signature used
to cover the body alone, which made it valid forever: one captured delivery — a proxy log,
a misconfigured receiver, a retry history — could be replayed verbatim at any later moment
and it verified. Binding the instant into the HMAC is what makes the window enforceable;
an attacker who advances the header to beat the window invalidates the signature.

**Migration.** `signWebhookBody(secret, body)` without a timestamp is still the original
body-only scheme, and `verifyWebhookSignature` without a `timestamp` option still checks
it — a receiver written against the old contract keeps working. A verifier that *asks* for
the timestamped scheme and finds no usable header is REFUSED rather than silently
downgraded to the replayable one: that downgrade is the attack.

> **Every consumer of `signWebhookBody` sends the timestamp** (grepped 2026-09-03, three
> senders, all done): `app/_lib/ats-egress.ts` (`deliver`, the ATS webhook — the header and
> the HMAC input are this attempt's instant; the envelope's `sentAt` is the delivery's, and
> the two agree on the first attempt), `app/_lib/comms.ts` (the
> candidate-comms relay; its bounded retry ladder reuses the same instant deliberately —
> it is the same delivery, and the ladder finishes far inside the window) and
> `app/api/comms/relay/test/route.ts` (the relay test ping, built exactly like a real
> delivery so a receiver wired against the ping is wired against production traffic).
> Pinned by `app/_lib/ats-egress-delivery.test.ts`, which asserts the header rides, the
> envelope agrees with it, the signature verifies only under the timestamped scheme, and
> a replay past the window does not.

The envelope, signing and delivery/retry semantics live in
[../comms/outbound-export.md](../comms/outbound-export.md).

## Personas bridge

The pairing card (`IntegrationsPersonasPanel` + `integrationsPersonasLogic`) is a
two-phase flow: `POST /api/agents/pair {phase:"start"}` mints a nonce, then a claim poll
waits for a human to approve in the Personas desktop app (a 300s in-memory TTL on that
side).

- **The claim poll backs off and stops when nobody is looking.** It was a fixed 2s tick
  for the full five minutes — 150 identical requests to watch a human decide, on a
  settings tab the operator has usually walked away from. The gap now grows 2s → ×1.5 →
  capped at 15s (`CLAIM_POLL_MS` / `CLAIM_POLL_FACTOR` / `CLAIM_POLL_MAX_MS`), so a quick
  approval is still noticed in seconds while a full TTL costs ~25 rounds; and the poll
  parks entirely while `document.visibilityState === "hidden"`, resuming *immediately* at
  the fast gap when the tab comes back — which is exactly when an approval is most likely
  to be waiting. The cap is deliberately far under the TTL: an unbounded curve would
  eventually out-wait the deadline.
- **The three ways the flow ENDS are pure and pinned.** `claimStep()` is the branch table
  of one round (deadline first, then paired / server error / retry) and
  `isSupersededAttempt()` is the guard that drops a continuation from an attempt the
  operator cancelled or restarted. All three used to be inline expressions with nothing
  asserting them; `integrationsLogic.test.ts` pins them, including that a claim landing
  *after* the deadline is a timeout even when it says `paired`.
- **The base-URL field uses the shared `TextInput`**, like every other control on this
  tab — it was the one bare `<input>` left on the `FIELD` recipe, which the recipe's own
  note asks new fields not to do.

## Surface

| Path | Role |
| --- | --- |
| `app/features/settings/integrations/IntegrationsTab.tsx` | Tab shell; calendar panel eager, every other panel deferred |
| `app/features/settings/integrations/IntegrationsCalendarPanel.tsx` | Connect / status / partial-grant / disconnect |
| `app/features/settings/integrations/IntegrationsCallbackBanner.tsx` | Renders one OAuth callback outcome |
| `app/features/settings/integrations/IntegrationsAtsPanel.tsx` | List + save/remove orchestration |
| `app/features/settings/integrations/IntegrationsAtsForm.tsx` | Add/update form |
| `app/features/settings/integrations/IntegrationsAtsRow.tsx` | One stored connection + removal confirm |
| `app/features/settings/integrations/IntegrationsWebhookPanel.tsx` | Outbound `kp.ats.v1` write-back: endpoint, signing secret, event subscriptions, test ping |
| `app/features/settings/integrations/IntegrationsWebhookFields.tsx` | That panel's form fields (URL / secret / events) |
| `app/features/settings/integrations/integrationsWebhookGate.ts` | `webhookTestable` — when "Send test" may be offered |
| `app/features/settings/integrations/integrationsPersonasLogic.ts` | The Personas pairing hook + its pure backoff / round / attempt-guard helpers |
| `app/api/ats/config/route.ts`, `app/api/ats/test/route.ts` | Write-back config (secret write-only, versioned, partial) + rate-limited test delivery |
| `app/_lib/calendar/callback-status.ts` | Canonical callback vocabulary + tone + scope slug |
| `app/_lib/calendar/google-oauth.ts` | Scopes, consent URL, token exchange, revoke, `missingScopes` |
| `app/_lib/calendar/token-store.ts` | Encrypted per-workspace grant; `getCalendarConnection` never returns a token |
| `app/_lib/calendar/free-busy.ts`, `available-slots.ts` | Busy-interval reasoning; slot proposal that degrades |
| `app/_lib/calendar/google-calendar.ts` | `fetchBusy` (null = unknown, `[]` = checked and clear) |
| `app/_lib/ats/connections-store.ts` | Per-provider credentials + `ATS_PROVIDERS` |
| `app/api/calendar/google/{start,callback}/route.ts`, `app/api/calendar/google/route.ts` | OAuth start, callback, status + revoke-first DELETE |
| `app/api/ats/connections/route.ts` | GET / POST / DELETE inbound connections |
| `app/api/ats/candidate/[id]/route.ts` | The per-candidate pull door: operator gate → workspace scope → consent gate → audit |
| `app/api/ats/candidate/ats-candidate-audit.ts` | Its pure helpers: the `ats_export` audit descriptor + the consent redaction |

## Data model

- `calendar_connections` — PK `(workspace_id, provider)`. One connection per **workspace**,
  not per recruiter: a team schedules against a shared hiring calendar. Columns:
  `account_email`, `calendar_id` (default `primary`), encrypted `refresh_token` /
  `access_token`, `access_expires_at`, `scopes_json`, `missing_scopes_json`, `connected_at`.
- `ats_connections` — PK `provider`. `base_url`, encrypted `api_token`, `field_map_json`,
  `enabled`, `version` (optimistic-concurrency token, bumped on every accepted write;
  back-filled to `0` by an `ALTER TABLE` on stores created before it existed),
  `updated_at`.
- `ats_config` — the outbound webhook. ONE row (`id = 1`), org-level by design
  (`app/_lib/tenancy.ts`). `webhook_url`, encrypted `webhook_secret`, `events_json`,
  `version` (optimistic-concurrency token, bumped on every accepted write; back-filled to
  `0` by an `ALTER TABLE` on stores created before it existed), `updated_at`. A corrupt
  `events_json` still resolves to "nothing subscribed" (fail closed) but is now LOGGED with
  the row id — `[]` was otherwise indistinguishable from an operator who unsubscribed.
- `ats_delivery` — the outbound delivery ledger, one row per (event, entry) attempt-set,
  org-level like the config. `event`, `entry_id`, `status` (`pending` / `delivered` /
  `failed`, read through a runtime guard), `attempts`, `last_status`, `last_error`,
  `next_attempt_at`, `created_at` (the envelope's stable `sentAt`), `updated_at`. Terminal
  rows are pruned after 90 days.

## Known gaps

- **A dead-lettered delivery cannot be replayed.** After `MAX_ATTEMPTS` (6, exponential from
  one minute — roughly half an hour of receiver downtime) a failed row keeps
  `next_attempt_at NULL` for good. `POST /api/ats/deliveries` sweeps only rows that are still
  *due*, so the terminal row is visible in the ledger but has no force-replay path; recovering
  that hire means editing the row by hand. `ats-delivery-store.ts` calls the dead-letter
  "force-retryable", which is the intent, not yet the code.
- **The retry ladder has no jitter, and it is not the comms ladder.** Six attempts,
  exponential from one minute, unjittered — a receiver that comes back after an outage takes
  every queued delivery in one thundering herd. The candidate-comms relay beside it has its
  own ladder with its own constants; the two should be one policy.
- **The route's own redaction path is now a second application.** With the consent gate in
  the record builder, `ats-candidate-audit.ts`'s `redactAtsRecordForConsent` is belt-and-braces
  for the expired-consent case rather than the enforcement; the anonymized case never
  reaches it (coded 410 above).
- **The field map has no UI.** A connection saved here uses the stored map (or an empty
  one), and an empty map has no `externalId` path — so a sync using it fails loudly rather
  than importing under a bad identity. Editing it still requires a `POST` with a `fieldMap`
  body.
- **`ats_connections` is not workspace-keyed** (unlike `calendar_connections`), so ATS
  credentials are installation-wide. Only the *links* are per-workspace.
- **Calendar connections are per workspace, not per interviewer.** Free/busy therefore
  reflects one shared calendar. The row is already keyed by workspace + account email, so
  adding a user dimension is additive.
- **No "test connection" action** for ATS, unlike the outbound webhook's test ping — a
  wrong token surfaces at the first sync.
- **Erasing a candidate keeps that entry's `ats_links` rows, by decision.** The link holds
  no personal data (provider, external id, stage) and the scrub in `app/_lib/db/pipeline.ts`
  lists it as a table that must OUTLIVE erasure: without it the next sync would re-import the
  same person as a NEW candidate, which is the worse outcome. The export side cannot
  re-identify through it (the record builder refuses an anonymized entry), and no inbound
  write path updates an existing entry from a vendor record today (`ats/inbound.ts` is a
  pure mapper). `deleteAtsLinksForEntry` (`app/_lib/ats/links-store.ts`, tested) exists for
  the day an inbound writer appears and needs to drop the join deliberately.
- `account_email` is never populated by the callback (no userinfo call), so a connected
  calendar shows *Unknown account* until it is set another way.
