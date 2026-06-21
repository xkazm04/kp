# Tri-Lens Fix Wave 1 — Endpoint Auth & Abuse (theme T2)

> 5 atomic fix commits, 5 criticals + 1 High closed.
> Baseline preserved: tsc 0 → 0 errors · unit tests 935 → 947 passing (+12 new), 0 regressions.
> Branch: `vibeman/triscan-fixes-2026-06-18` (off `main`).

## Commits

| # | Commit | Finding | Severity | Files |
|---|---|---|---|---|
| 1 | `bba8851` | model-api-key-mgmt #2 — Azure endpoint SSRF | Critical | safe-url.ts, llm-config.ts, safe-url.test.ts |
| 2 | `01d6377` | application-intake-apply #1 — apply POSTs unthrottled | Critical | api/apply/[id]/route.ts, .../quick/route.ts |
| 3 | `97ec1e0` | comms-inbound-channels — webhook no idempotency | Critical | webhook-idempotency.ts (+test), api/channels/inbound/[token]/route.ts |
| 4 | `026aa53` | model-api-key-mgmt #1 + #4 — LLM routes auth + stderr leak | Critical + High | require-operator.ts, redact-secrets.ts (+test), api/llm/{keys,config,test}/route.ts |
| 5 | `9ef95f5` | jd-authoring-library #3 — anon JD edit/archive/revert | Critical | require-operator.ts, api/jds/[slug]/{route,revisions/route}.ts, jds/[slug]/page.tsx |

## What was fixed

1. **Azure endpoint SSRF (crit).** A provider key's `endpoint` was stored after only a non-empty-string check, then handed to the provider SDK *with the decrypted key*. Added `assertPublicHttpsEndpoint()` (require `https:`, reject bare IPs — metadata `169.254.169.254`/loopback/LAN/IPv6 — and internal/`.local`/`.internal` hosts), enforced centrally in `saveProviderKey()` with an extra `*.openai.azure.com` constraint for Azure (extensible via `KP_LLM_ENDPOINT_ALLOWLIST`). Rejects at store time → existing 400 on PUT.

2. **Public apply POSTs rate-limited (crit).** `/api/apply/[id]` (spawns Python + dispatches email) and `/quick` had zero throttling while the sibling inbound route already used `rateLimit`. Added per-(job, client) fixed windows (20/min conversational, 30/min quick), checked before any DB read or Python spawn.

3. **Inbound webhook idempotent (crit).** A provider retry re-recorded a receipt (inflating Channels liveness), fired another `re_applied`, and re-acked. Added an in-process idempotency claim keyed on an `Idempotency-Key` header or SHA-256 of the body; held key → idempotent 200, released on failure so genuine retries re-run.

4. **LLM admin routes operator-guarded + `/test` stderr scrubbed (crit + High).** Added handler-level `requireOperator()` (semantics match `proxy.ts` — no-op in open mode, session check when `KP_OPERATOR_PASSWORD` set) on keys/config/test as defense in depth for secret-writing/Python-spawning routes. `/test` now logs raw stderr server-side and returns only a `redactSecrets()`-scrubbed tail (the canary runs with the decrypted key in `KP_LLM_CONFIG`).

5. **JD edit/archive/revert gated (crit).** The public, shareable JD page rendered Edit/Archive/Revert unconditionally with unauthenticated backing routes. Added `requireOperator()` to PATCH + revisions POST (GET stays public) and hid `JdActions` from non-operator viewers via `isOperator()`.

## Important context — `proxy.ts` already provides edge auth (the scan's "no middleware" was partly a false alarm)

The `model-api-key-mgmt` and `jd-authoring` subagents reported "no `middleware.ts` at app root." **Next 16 renamed `middleware` → `proxy`, and `proxy.ts` at the repo root IS the gate**: it fail-closes every non-public route when `KP_OPERATOR_PASSWORD` is set (the LLM and JD routes are NOT in its public allowlist). So in production those routes were already gated; the genuine exposure was (a) open mode (no password — intentional for local/dev) and (b) no defense-in-depth on secret-writing routes / no UI hiding of destructive controls on a would-be-public page. Fixes 4 & 5 are therefore framed as **defense in depth that matches `proxy.ts` semantics exactly** (zero behavior change), not as the sole gate. Fixes 1–3 (SSRF, rate-limit, idempotency) are **unconditional** wins independent of auth.

## Verification

| Gate | Before wave | After wave |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `node --test app/**/*.test.ts` | 935 pass / 0 fail | 947 pass / 0 fail (+12) |

New tests: `safe-url.test.ts` (+4 SSRF cases), `webhook-idempotency.test.ts` (5), `redact-secrets.test.ts` (3).

## Patterns established (catalogue)

1. **Edge gate ≠ no gate.** Before flagging "route has no auth," confirm the framework's middleware/proxy layer (Next 16 = `proxy.ts`, not `middleware.ts`) and whether it's opt-in. Add handler-level checks as *defense in depth with matching semantics*, never as a regression to open mode.
2. **SSRF-grade URL check ≠ render-time URL check.** A server-fetched URL (with a key) must reject bare IPs + internal hosts at store time; a render-time link only needs the scheme guard. Keep them separate functions.
3. **In-process guard for single-process public surfaces.** Rate-limit and webhook-idempotency both use a lazily-swept `Map` (documented single-process design) — proportionate for kp; swap behind the function shape if it ever scales out.
4. **Claim-release idempotency.** Mark the key claimed before side effects; release on failure so a 5xx-then-retry re-runs (idempotency persists only for successful work).
5. **Scrub, don't echo.** Forward only a `redactSecrets()`-scrubbed error tail across a trust boundary when a secret shares the process; log full detail server-side.

## What remains (per INDEX themes)

- **Open follow-up (product call):** should `/jds/[slug]` be in `proxy.ts`'s public allowlist so shared JD links work when auth is on? Fix 5 makes that safe to enable but doesn't change the allowlist.
- **Next waves:** T1 Workspace tenancy (the live-the-moment-a-2nd-workspace-exists leak), T3 Billing integrity, T5/T6 pipeline-state + unwired features, T4 AI quality, T7/T8/T10 durability/XSS/timezone, T9/T11 conversion + UI. See `INDEX.md`.
- The XFF-spoofing weakness in `clientIpFrom` (shared-utility-libs #36) makes per-IP limits soft; tracked as its own finding for the utilities wave.
