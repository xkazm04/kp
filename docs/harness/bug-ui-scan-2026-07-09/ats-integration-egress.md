# ATS Integration & Egress — bug-hunter + ui-perfectionist scan

> Context: Outbound integration that maps a pipeline entry into a versioned `kp.ats.v1` record and POSTs HMAC-signed lifecycle webhooks to a customer-configured URL.
> Files reviewed: 8 of 8
> Total: 5

## 1. Server-side SSRF: webhook URL has no private-IP/metadata guard, `http:` allowed, and `/api/ats/test` is an authenticated probe

- **Severity**: Critical
- **Lens**: bug-hunter
- **Category**: validation-gap / SSRF
- **File**: `app/_lib/ats-config-store.ts:76-89` (validateUrl), `app/api/ats/test/route.ts:9-15`, `app/_lib/ats-egress.ts:52-64` (deliver)
- **Scenario**: An authenticated operator POSTs `/api/ats/config` with `webhookUrl = "http://169.254.169.254/latest/meta-data/iam/security-credentials/"` (or `http://127.0.0.1:6379/`, or any RFC-1918 host), then POSTs `/api/ats/test`. The server performs `fetch(cfg.webhookUrl)` and returns the target's HTTP status to the caller (`Delivered — endpoint responded 200`), turning the app into an authenticated SSRF + internal-port scanner reaching the cloud metadata endpoint.
- **Root cause**: `validateUrl` only asserts the scheme is `http:`/`https:` — it never rejects bare IPs, loopback, link-local, or `.internal`/`.local` hosts, and even permits plaintext `http`. The repo already has the exact guard for this class — `assertPublicHttpsEndpoint` in `app/_lib/safe-url.ts:82` (used by `llm-config.ts`) — but this egress surface does not call it. (Note: that guard has a sibling-filed DNS-rebind gap; this surface uses no guard at all, so it is strictly worse.)
- **Impact**: security breach — theft of cloud IAM credentials via metadata, internal service discovery, and cleartext egress of candidate PII over `http`.
- **Fix sketch**: Route `validateUrl` through `assertPublicHttpsEndpoint` (https-only, no IP literals/loopback/internal names); additionally resolve-and-pin the host at delivery time (or block on connect) to close DNS-rebind. Make the guard the single validation path so config-save and test share it.

## 2. ATS routes enforce authentication only — any org member can redirect all candidate-PII egress or clear the signing secret

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: validation-gap / broken-authorization
- **File**: `app/api/ats/config/route.ts:9-24`, `app/api/ats/test/route.ts:9`, `app/api/ats/candidate/[id]/route.ts:8`
- **Scenario**: The org role/capability model (5 roles, per-membership overrides) exists, but none of these handlers resolve it — they import zero auth helpers and rely solely on the `proxy.ts` session gate, which only proves *a* valid session, not an admin/owner. A low-privilege member (or a viewer) can POST `/api/ats/config` to re-point `webhookUrl` at their own server (silently exfiltrating every future `candidate.hired` PII payload) or send `webhookSecret: ""` to clear the secret so all deliveries go out unsigned.
- **Root cause**: The route comment calls this a "Recruiter-admin surface," but authorization is asserted nowhere; authentication is mistaken for authorization. The proxy gate is coarse (session-valid) by design.
- **Impact**: security — PII exfiltration and integrity downgrade (unsigned webhooks) by any authenticated principal regardless of role.
- **Fix sketch**: Add an explicit capability check (e.g. `requireOperator`/admin capability) at the top of each ATS handler. Centralize it so config-mutation, test-fire, and per-candidate export can't each be forgotten independently.

## 3. Signing secret stored in plaintext and exfiltrated by the whole-DB export — the write-only doctrine is defeated

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: secret-leakage
- **File**: `app/_lib/ats-config-store.ts:32-40,124` (plaintext `webhook_secret TEXT`), `app/_lib/db-portability.ts:67-75`
- **Scenario**: The GET `/api/ats/config` doctrine correctly hides the secret behind `hasSecret`. But `webhook_secret` is persisted as plaintext, and the portability dumper (`SELECT name … FROM sqlite_master`, then every column of every table) emits `ats_config` verbatim — so `/api/workspace/export` ships the HMAC signing secret in clear, out a different door than the guarded read path. Provider LLM keys, by contrast, are encrypted at rest via `KP_SECRET`; this secret is not.
- **Root cause**: The "never surfaced to the client" doctrine is enforced only on the dedicated GET endpoint, not as a property of the secret at rest. A generic table dumper has no allow-list, so any plaintext secret leaks by default.
- **Impact**: security — leaked shared secret lets an attacker forge valid `sha256=` signatures and inject spoofed `candidate.hired`/`offer.accepted` events into the customer's ATS.
- **Fix sketch**: Encrypt the secret at rest (reuse the provider-key encryption) and/or add `ats_config.webhook_secret` to a redaction/exclusion list in `db-portability`. Make secret columns opt-in to export rather than opt-out.

## 4. Lifecycle events lost silently: no retry/dead-letter, and a receiver 4xx/5xx is recorded as delivered

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: `app/_lib/ats-egress.ts:59-84` (deliver + dispatchAtsEvent), `app/_lib/offer-finalize.ts:128`
- **Scenario**: On offer-accept, `void dispatchAtsEvent("candidate.hired", …)` fires. If the receiver is briefly down or the request times out (5s), the event is dropped with only a `console.error` — no retry, no dead-letter, no delivery ledger. Worse: `deliver` returns `{ delivered: true, status: r.status }` for **any** HTTP response, so a receiver returning 500/503/401 is treated as delivered and never even logged as a failure. The customer's "system of record" silently diverges from reality on the single most important event.
- **Root cause**: Best-effort fire-and-forget with success defined as "the socket returned bytes," not "the receiver accepted." The sibling onboarding dispatch in the same function records a durable `onboarding_failed` reconcile event; the ATS dispatch records nothing operator-visible.
- **Impact**: silently wrong result — permanent, invisible loss of hire/reject/offer events; the promised mirror is unreliable with no signal to reconcile.
- **Fix sketch**: Treat non-2xx as not-delivered; persist a delivery record (event, entry, status, attempts) and retry with backoff (or surface a reconcile event like onboarding does) so a missed webhook is visible and replayable.

## 5. Per-candidate PII export is unscoped, unlogged, and enumerable

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: validation-gap
- **File**: `app/api/ats/candidate/[id]/route.ts:8-15`, `app/_lib/ats-egress.ts:21-43` (getAtsRecord)
- **Scenario**: `GET /api/ats/candidate/<entryId>` returns a full normalized record — display name, contact, archetype, salary offer, sealed decision — with no workspace/tenant scoping, no rate limit, and no audit entry. Any authenticated session can iterate entry ids and pull every candidate's PII record; nothing records that the bulk read happened.
- **Root cause**: `getAtsRecord` fetches purely by entry id with no caller-context filter, and the route adds a brand-new by-id PII egress door without the auditing/scoping the sensitivity warrants (adjacent to, but distinct from, the known half-built tenancy gap — this surface has no scoping *or* logging at all).
- **Impact**: security / privacy — undetected bulk PII harvest by any authenticated principal.
- **Fix sketch**: Scope the lookup to the caller's workspace, gate behind the admin capability from finding #2, and write an audit record per export. Consider a rate limit to blunt enumeration.
