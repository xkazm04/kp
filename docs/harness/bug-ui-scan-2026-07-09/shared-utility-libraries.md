# Shared Utility Libraries — bug-hunter + ui-perfectionist scan

> Context: Cross-cutting low-level utilities — caching, logging, env parsing, rate limiting, URL/ID safety, API response shaping, dedupe and distribution.
> Files reviewed: 16 of 21
> Total: 5

## 1. Public skill-profile credential token is minted with the NON-crypto `randomId`

- **Severity**: Critical
- **Triage note**: Promoted High -> Critical at triage: the token is the sole auth on a public PII endpoint, and `skill-matrix-coverage.md` #2 independently found an unauthenticated existence oracle that makes guessing practical.
- **Lens**: bug-hunter
- **Category**: trust-boundary / weak-token
- **File**: `app/_lib/random-id.ts:21` (`randomId`), misused at `app/_lib/db/skill-profiles.ts:101`
- **Scenario**: A recruiter issues a durable "skill profile" credential for a candidate. The gating token is minted as `const token = randomId("dsp")`, i.e. `dsp-<base36 Date.now()>-<~6 base36 Math.random() chars>`. That token is the ONLY auth on the public credential surface — `getSkillProfileByToken` (`skill-profiles.ts:120`), `verifySkillProfileToken` (`:129`), `/api/skill-profile/[token]/verify`, and `/skill/[token]/page.tsx`. An attacker recovers V8's `Math.random` state (or brute-forces ~31 predictable bits combined with a near-known millisecond prefix) and enumerates valid `dsp-` tokens.
- **Root cause**: `random-id.ts` deliberately ships two tiers with different trust levels and documents the rule in its own header: `randomId()` = "INTERNAL primary keys. Never a security boundary… For anything that gates access, use randomToken() instead." `randomToken()` (24 CSPRNG bytes) exists for exactly this. The skill-profile mint reached for the wrong one — and the comment two lines below (`skill-profiles.ts:104`) even calls it "the unguessable token," which it is not. Nothing in the helper makes this misuse hard.
- **Impact**: Enumerable/guessable credential → disclosure of candidate PII (candidateRef, evaluation axes, scores) and a forgeable "verified" trust attestation, with no other authn. Offer/schedule/interview tokens correctly use `randomToken`, so this one call site is the outlier.
- **Fix sketch**: Change `skill-profiles.ts:101` to `randomToken("dsp")`. To kill the class: rename/segregate so access tokens can't accidentally draw from `randomId` — e.g. a branded `AccessToken` type returned only by `randomToken`, and have stores that persist a `token` column require it. Add a lint/grep gate flagging `randomId(` results assigned to a variable named `token`.

## 2. [STILL-OPEN] `assertPublicHttpsEndpoint` vets only the literal host — DNS rebinding still pivots SSRF + key exfil

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: ssrf / trust-boundary
- **File**: `app/_lib/safe-url.ts:82` (`assertPublicHttpsEndpoint`), `:65` (`isIpLiteralHost`); harmed at `app/_lib/llm-config.ts:99`
- **Scenario**: An operator stores an Azure/OpenAI endpoint `https://metadata.attacker.com`. It passes every check (https, not a bare IP, not `localhost`/`.local`/`.internal`), so `llm-config.ts:99` accepts it. At call time the server resolves the name; the attacker's DNS returns `169.254.169.254` / `127.0.0.1` / an RFC-1918 host, and the bearer key is sent there.
- **Root cause**: The guard validates the URL *string*, never the *resolved* address. Its own doc claims it "closes 169.254.169.254 metadata, 127.x loopback and every RFC-1918 LAN in one rule," true only for literal-IP hosts — a DNS name resolving into those ranges sails through. STILL matters: the 2026-06-20 report filed this and the string-only check is unchanged on `main`; it is the single vet before a server-side fetch that carries a provider key.
- **Impact**: Server-side request forgery + provider-key exfiltration to an internal/metadata target, reachable by anyone who can set the endpoint.
- **Fix sketch**: Resolve the host at validation time and reject if any A/AAAA record is loopback/link-local/RFC-1918/ULA; ideally pin the resolved IP through to the fetch (or egress via a provider-domain allowlist). At minimum, stop claiming the string check is rebinding-safe.

## 3. `publicBaseUrl` never validates its result is an absolute, deployment-owned origin

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: validation-gap / silent-failure
- **File**: `app/_lib/public-base-url.ts:30` (`publicBaseUrl`)
- **Scenario**: Two reachable failure modes from the same gap. (a) Origin-less callers — `offer-reminders.ts:30` and `preboarding-reminders.ts:33` call `publicBaseUrl()` with no runtime origin ("heartbeat has no request origin"). If `APP_BASE_URL`/`NEXT_PUBLIC_APP_BASE_URL` are unset, the helper returns `""`, so the reminder emails a host-less relative link (`/offer/<token>`) that is dead in a mail client. (b) Request-derived callers on public endpoints — `channels/inbound/[token]/route.ts:242` (`enrichLink`) and `apply/[id]/route.ts:385` (`statusLink`) build the base from `new URL(request.url).origin`, which in a Next route handler reflects the incoming (attacker-influenceable) Host header; a poisoned Host yields a candidate-delivered link pointing at the attacker's domain.
- **Root cause**: The helper resolves a precedence chain but treats whatever falls out — empty string, or an unverified request origin — as a usable public base. It never asserts the result is a non-empty absolute `https` origin belonging to the deployment.
- **Impact**: Broken candidate links (offer/onboarding reminders) silently, on a common misconfig; and a phishing/open-redirect surface on the public inbound + apply paths. Blast radius is ~20 candidate-link call sites (offer, schedule, apply, interview, onboarding, billing checkout return URL).
- **Fix sketch**: Have `publicBaseUrl` throw (or log-and-refuse) when the resolved base is empty, and validate the runtime-origin fallback against a configured allowlist of public hosts before trusting it. Make the origin-less overload require a configured override so background jobs can never emit a relative link.

## 4. `intakeSubmission` commits the submission before the ack — a failure between them permanently drops the acknowledgement

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure / edge-case
- **File**: `app/_lib/distribution.ts:88-99` (`intakeSubmission`); callers `app/api/devcase/submit/route.ts:24`, `app/api/devcase/inbound/route.ts:44`
- **Scenario**: A candidate submits work. `createSubmission` commits the row with `created: true`, THEN `await sendComm(... kind: "acknowledgement")` runs. If `sendComm` throws (its `recordOutbox` DB write fails, or the webhook path's `buildCommEnvelope`/`getPipelineEntry` throws), `intakeSubmission` throws and the route returns an error — but the submission row is already persisted. On the candidate's retry, the atomic dedup returns `created: false`, so the code `return`s at `:89` BEFORE `sendComm` — the acknowledgement is never sent, on this attempt or any future one.
- **Root cause**: The "send the ack" side effect is gated solely on the *first-insert* boolean, with no durable "ack pending" state. Commit-then-notify with no reconciliation assumes the notify half never fails independently of the commit half.
- **Impact**: A candidate's submission is recorded but they silently never receive the "we received your submission" message, and no retry can recover it — the exact ghosting the closed-posting guard elsewhere in this file exists to prevent.
- **Fix sketch**: Record an `ack_sent` flag on the submission and drive the acknowledgement from an idempotent "send if new-or-unacked" step, so a retry that finds an existing-but-unacked row still fires the ack. Never couple an external notification's only trigger to a one-shot insert flag.

## 5. `getAdapter` silently maps an unknown distribution channel to the local stub

- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent-failure / unsafe-default
- **File**: `app/_lib/distribution.ts:53` (`getAdapter`); caller `app/api/devcase/publish/route.ts:13`
- **Scenario**: `POST /api/devcase/publish` does `getAdapter(body.channel ?? "local").publish(devCase)` with a client-supplied `channel`. If a caller (or a future channel selector) passes `"email"`/`"ats"`/a typo, `getAdapter` returns `ADAPTERS[channel] ?? ADAPTERS.local` — the local stub — and publishes a local posting, returning 200 as if the requested channel succeeded.
- **Root cause**: The `?? ADAPTERS.local` fallback treats "channel not implemented" as "use local," conflating an unsupported request with the default. The caller would rather learn the channel is unavailable than have the publish silently no-op somewhere else.
- **Impact**: A recruiter who believes they distributed a role to an external channel actually only created a local posting; candidates never see it. Today only `local` is implemented so exposure is small, but the helper is the shared seam every future channel plugs into.
- **Fix sketch**: Reject an unknown channel — `getAdapter` should throw (or return `null` for the route to 400) on an unregistered channel, and default only when the argument is omitted. Keep the local fallback strictly for the no-argument case.
