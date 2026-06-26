# Shared Utility Libraries — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀4 / 🚀1 | Severity: C0/H1/M4/L0

## 1. Rate limiter trusts a forgeable `x-forwarded-for` first hop with no documented deployment requirement
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: security / hidden assumption
- **File**: app/_lib/rate-limit.ts:40
- **Observation**: `clientIpFrom` takes the FIRST `x-forwarded-for` hop as the client key (line 42). XFF is fully client-controllable: if kp is exposed directly (or behind a proxy that *appends* rather than *overwrites* XFF), an attacker rotates `x-forwarded-for: <random>` per request and every request lands in a fresh `Map` bucket — the fixed-window limiter is silently bypassed. The header comment ("Behind a proxy the first hop is the caller") states the happy-path assumption but never records the deployment requirement that makes it safe (a trusted proxy that overwrites XFF), nor warns that direct exposure defeats the limiter. This is the ONLY abuse control on side-effect-bearing public routes that dispatch candidate email (offer confirm, schedule invite, apply).
- **Why it matters**: A defeated limiter re-opens exactly the notification-flooding / comms-provider-cost abuse the limiter (idea-3e49abaf) was built to stop — a security hole hidden behind an undocumented infra assumption. Operators have no signal that the protection is inert.
- **Recommendation**: Document the hard deployment contract (proxy MUST overwrite XFF) at the call boundary; ideally derive the client hop from the right based on a configured trusted-proxy count, and fall back to a non-spoofable identity when no trusted proxy is configured. Add a test asserting a rotating XFF cannot exceed the limit.
- **Effort**: M

## 2. Rate-limit windows are scattered, unexplained magic numbers and the helper's header doc is stale
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: magic numbers / drift
- **File**: app/_lib/rate-limit.ts:1
- **Observation**: The limiter is invoked from ~9 routes with hand-tuned literals and no shared rationale: offer/onboarding/schedule `10/60s`, schedule-invite `30/60s`, invite-bulk `10/60s`, demo `12/600s` (app/api/demo/route.ts:22), apply `20/60s`, apply-quick `30/60s` (app/api/apply/[id]/quick/route.ts:38), inbound channels `60/60s` (app/api/channels/inbound/[token]/route.ts:41). Some are named constants, some inline. None document *why* that number. Meanwhile the file header (lines 1–11) still claims the limiter covers only "POST /api/offer, POST /api/schedule and POST /api/schedule/invite" — stale by six routes. Sibling utils (entries-param.ts:16–26) centralize their caps with rationale; rate limits do not.
- **Why it matters**: Tuning or auditing these limits means hunting nine files and reverse-engineering intent. 🚀 The demo route's `12 / 10 min` per IP silently caps a top-of-funnel trial flow — if a sales demo or shared-NAT evaluator trips it, the limit throttles a conversion path with no recorded reasoning for the number.
- **Recommendation**: Hoist a single `RATE_LIMITS` table (key → {limit, windowMs, rationale}) alongside the limiter, cite it from routes, and refresh the header doc to list every protected surface.
- **Effort**: S

## 3. `distribution.ts` re-inlines its own 128-bit token instead of the centralized `randomToken()` — the exact drift `random-id.ts` exists to prevent
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: dark capability / invariant drift
- **File**: app/_lib/distribution.ts:21
- **Observation**: The apply/posting token — explicitly "effectively a bearer credential" gating who may POST dev-case submissions — is minted by a local `token()` returning `randomBytes(16).toString("hex")` (128-bit, hex, no prefix). The shared `randomToken()` (app/_lib/random-id.ts:31) produces a 192-bit, base64url, prefixed token and was built precisely so "the id scheme [is] one helper instead of N drift-prone copies." distribution.ts is one of those un-adopted copies. The rate-limit.ts header even asserts as fact "Tokens themselves are strong (192-bit CSPRNG)" (line 6) — which is untrue for this token (128-bit).
- **Why it matters**: A hardening utility built and adopted elsewhere is only half-adopted, leaving a security-relevant token outside the single source of truth and contradicting a documented invariant. Each divergent copy is a place a future "wrong slice length or missing prefix" (random-id.ts's own warning) can slip through review.
- **Recommendation**: Replace `distribution.ts` `token()` with `randomToken("apply")`; grep for other inlined `randomBytes(...).toString` token mints and route them through the helper. Correct the rate-limit.ts comment.
- **Effort**: S

## 4. Analyze cache fails open silently and has no single-flight — billable LLM spend leaks with no operator signal
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: edge case / cost reliability
- **File**: app/_lib/cache.ts:14
- **Observation**: Both `lookupCachedAnalysis` and `storeCachedAnalysis` swallow every error to `console.error` and return (lines 14–17, 23–25). If the cache DB degrades (disk full, lock contention, corruption), the system silently behaves as "always miss" — every analyze re-runs the billable Gemini pipeline with no metric, alert, or `cache_hit=false`-rate signal beyond a console line. Separately, the lookup→store flow in analyze-run.ts:108–150 is plain check-then-act: two concurrent requests for the same CV+JD+lang both miss and both spawn the paid Python/LLM call (no single-flight/lock). The TTL is one global `KP_CACHE_TTL_HOURS=24` (cache.ts:9) with eviction/size bound delegated entirely to the DB and undocumented here.
- **Why it matters**: The analyze step is the product's core paid flow; a cache that fails open invisibly turns an infra blip into unbounded LLM cost with no paging. The undocumented "best-effort, no stampede protection" trade-off is exactly the kind of hidden assumption this lens targets.
- **Recommendation**: Surface a cache-error counter / health signal (don't only console.error); document the best-effort + no-single-flight trade-off at the function; consider an in-process single-flight keyed on the cache key for concurrent identical analyses.
- **Effort**: M

## 5. `assertPublicHttpsEndpoint` docstring overclaims SSRF coverage — a public DNS name pointing at an internal IP passes
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: security overclaim / undocumented residual risk
- **File**: app/_lib/safe-url.ts:82
- **Observation**: The guard validates the endpoint *string*: rejects non-https, bare IP literals, and a fixed suffix list (`localhost`/`.local`/`.internal`). Its comment claims this "closes 169.254.169.254 metadata, 127.x loopback and every RFC-1918 LAN in one rule" (lines 64–67) — but that is true only for *literal* IPs. A perfectly public DNS name (`metadata.attacker.com`) with an A record of `169.254.169.254` or `10.x` passes every check, and is later fetched server-side by the provider SDK (llm-config.ts:98). Only the `azure_openai` branch adds a host allowlist backstop (llm-config.ts:101); every other provider relies on this guard alone, so the residual DNS-based internal-SSRF is real and undocumented. The docstring's "key-exfiltration pivot" framing also overstates: caller supplies key + endpoint together, so the live risk is internal-network reach (probing/hitting internal services), not key theft.
- **Why it matters**: A confidently-worded safety utility that an auditor would trust as "SSRF-complete" actually leaves a standard DNS-resolution bypass open for non-Azure custom endpoints — precisely the tribal-knowledge gap (string check ≠ resolved-IP check) that should be written down.
- **Recommendation**: Soften the docstring to state it validates the *literal* host only and does not resolve DNS; extend the Azure-style host allowlist to all providers, or resolve-and-check the IP at fetch time. Re-frame the threat note to internal-network SSRF.
- **Effort**: M
