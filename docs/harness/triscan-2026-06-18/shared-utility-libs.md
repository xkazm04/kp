# Shared Utility Libraries — Tri-Lens Scan
> Total: 5
> Severity: 0 Critical / 2 High / 3 Medium / 0 Low
> Lens: 4 bug / 0 ui / 1 biz

Scope note: 🎨 UI Perfectionist is **N/A** for this context — these are headless cross-cutting utilities with no rendered surface, so that lens is skipped per the brief. 🐛 Bug Hunter dominates (4 of 5); 🚀 Business Visionary contributes 1 (observability of the in-process limiter at scale). `distribution.ts` is the channel-adapter seam, not "distribution math" — its only math-shaped path (`token()` / dedup) is CSPRNG-correct and DB-atomic, so no finding there. The cache-key (length-framed sha256), env-parse (reject-NaN/≤0), `randomToken` (192-bit CSPRNG), and prompt-cache TTL (fail-closed on bad expiry, bounded prune) paths were all reviewed and are sound.

## 1. Per-IP rate limit is bypassable by spoofing `x-forwarded-for`
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: High
- **Category**: Rate-limit bypass / trust boundary
- **Value**: impact 8/10 · effort 3/10 · risk 3/10
- **File**: `app/_lib/rate-limit.ts:40-47`
- **Scenario**: The four public side-effecting token routes (`/api/offer/[token]`, `/api/schedule/[token]`, `/api/schedule/invite`, `/api/channels/inbound/[token]`) all throttle on a key built from `clientIpFrom(request.headers)`. `clientIpFrom` returns the **first `x-forwarded-for` hop verbatim**. That header is fully attacker-controlled — Next.js does not strip or validate it — so a caller sends `X-Forwarded-For: <random>` on every request, lands in a brand-new window each time, and sails past `limit:10/30/60`. The accept-offer and invite paths each dispatch a candidate email, so the throttle that exists specifically to "flood the comms provider and impose costs" (file header) is defeated with one header line.
- **Root cause**: The proxy hop is trusted unconditionally. There is no notion of a trusted-proxy boundary (the real client IP is only knowable from the *last* hop the deployment's own proxy appends, or from a platform header like `x-vercel-forwarded-for`), and no fallback that an attacker can't forge.
- **Impact**: Comms-provider cost amplification and candidate-inbox flooding on every public endpoint; the rate limiter is effectively cosmetic against a motivated abuser. High blast radius — it gates every public token surface.
- **Fix sketch**: Take the rightmost untrusted hop (or a configured trusted-proxy depth) instead of `split(",")[0]`; or key on the platform's verified client-IP header when present. As defence-in-depth, ALSO key a coarse limiter on the token itself (which the attacker can't rotate) so per-token abuse is bounded regardless of IP.

## 2. Rate-limiter `windows` Map grows unbounded between 60 s sweeps
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: High
- **Category**: Memory leak / unbounded in-process map (DoS)
- **Value**: impact 7/10 · effort 4/10 · risk 3/10
- **File**: `app/_lib/rate-limit.ts:15-35`
- **Scenario**: `windows` is a module-global `Map` with **no max-size cap**. Eviction happens only in the lazy sweep, which (a) runs at most once per `SWEEP_EVERY_MS` (60 s) and (b) deletes only *already-expired* windows. Combined with finding #1, an attacker rotating `x-forwarded-for` mints a fresh key per request; within a single 60 s window none of those keys are expired, so none are swept. At even modest request rates that is hundreds of thousands of live `{count,resetAt}` entries accumulating before the next sweep — heap pressure / OOM on the single Next process, taking down every route.
- **Root cause**: A fixed-window limiter keyed on caller-controlled input with no cardinality bound. Sweep is time-gated AND only reclaims expired entries, so a burst of distinct keys inside one window is never bounded.
- **Impact**: Process-wide availability risk from a cheap unauthenticated request stream; the limiter meant to contain abuse becomes the abuse vector.
- **Fix sketch**: Cap `windows.size` (e.g. reject/LRU-evict past N entries), and/or sweep when size crosses a threshold rather than only on the 60 s timer. Fixing #1 (bounding key cardinality to real client IPs) is the primary mitigation; this cap is the safety net.

## 3. `jsonError` forwards raw `error.message` to the client — internal-detail leak on the public inbound route
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: Medium
- **Category**: Information disclosure
- **Value**: impact 6/10 · effort 2/10 · risk 2/10
- **File**: `app/_lib/api-response.ts:12-15` (consumed at `app/api/channels/inbound/[token]/route.ts:117-122`)
- **Scenario**: `api-response.ts` ships two responders: `jsonError` (returns `err.message` as-is) and `safeJsonError` (logs server-side, returns a generic message + code — built precisely to stop SQLite/fs detail leaking). The public, token-only inbound-lead receiver does **not** use `safeJsonError`; its catch block hand-rolls `error instanceof Error ? error.message : …` and returns it. That path sits on better-sqlite3, `intakeLead`, and `getTranslations`, whose thrown messages embed `SQLITE_*`, `UNIQUE constraint failed: …`, and absolute db paths — handed to an unauthenticated external integrator.
- **Root cause**: The leak-safe pattern is opt-in per route, and a public endpoint opted out (raw ternary). The header of `api-response.ts` even documents that `jsonError` is only "fine for routes whose messages are already client-safe" — this one isn't.
- **Impact**: Schema/table names, constraint names and filesystem paths exposed on a public surface — reconnaissance that narrows further attacks.
- **Fix sketch**: Replace the inbound route's catch with `safeJsonError(error, "api:channels:inbound", <new STORE_ERRORS code>)`. Optionally make `jsonError` itself redact in production (NODE_ENV check) so the unsafe default can't leak by omission.

## 4. `safeHttpUrl` accepts loopback / private / credentialed hosts — fine for render today, an SSRF/redirect trap if reused server-side
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: Medium
- **Category**: URL safety hardening (latent SSRF / open-redirect)
- **Value**: impact 5/10 · effort 3/10 · risk 2/10
- **File**: `app/_lib/safe-url.ts:34-45`
- **Scenario**: The guard rejects non-http(s) schemes (good — kills `javascript:`/`data:`) but otherwise passes ANY http(s) URL: `http://localhost:6379`, `http://169.254.169.254/latest/meta-data/` (cloud metadata), `http://10.0.0.5`, or `https://user:pass@evil.com`. As a render-time anchor `href` this is currently low-harm. But the file is named/positioned as *the* single URL trust boundary for model-supplied URLs, and the model emits these strings; the moment any caller uses a "vetted" `SafeLink.href` for a server-side `fetch` (link preview, citation re-fetch, grounding revalidation), it's a textbook SSRF, and the credentialed-host case can leak the embedded creds.
- **Root cause**: The allowlist covers scheme only, not host class; the type name `SafeLink` over-promises "safe" for uses beyond a clickable anchor.
- **Impact**: Today: a recruiter-facing link can point at an internal host disguised behind the bare hostname text. Future: SSRF to metadata/internal services if the "safe" URL is ever fetched.
- **Fix sketch**: Add an optional `{ blockPrivateHosts?: boolean }` mode that rejects loopback/link-local/RFC-1918 hostnames and any `username`/`password` in the URL; document that `safeHttpUrl` vets for *linking only* and a separate gate is required before any server-side fetch.

## 5. In-process limiter has no observability — silent throttling/abuse at scale
- **Lens**: 🚀 Business Visionary (primary)
- **Severity**: Medium
- **Category**: Reliability / observability of shared infra
- **Value**: impact 5/10 · effort 3/10 · risk 2/10
- **File**: `app/_lib/rate-limit.ts:21-35`
- **Scenario**: `rateLimit` returns only a boolean and emits no signal. When the public routes start returning 429s — whether from a genuine abuse burst or from the limit being mistuned for a legitimate ad-burst on `/api/channels/inbound` (limit 60/min) — operators have **no counter, log, or metric** to tell which, nor how close normal traffic runs to the ceiling. The codebase already established the `getScheduleReconcileCount()` / `getScheduleNoSlotsCount()` process-counter pattern in `logger.ts` for exactly this kind of silent-divergence visibility; the limiter never got it.
- **Root cause**: Limiter designed as a pure pass/fail predicate with no telemetry seam, consistent with "in-process by design" but missing the matching ops signal.
- **Impact**: Throttling tuned blind; an abuse wave or a too-tight limit dropping real candidate leads both look identical (a quiet 429) until someone notices missing pipeline entries.
- **Fix sketch**: Add `getRateLimitStats()` returning per-key-prefix allowed/blocked counts (mirroring the logger counters), and `console.warn` the first block per key per window. Surfaces in the existing ops panel that already shows `promptCacheStats()`.
