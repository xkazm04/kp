# Shared Utility Libraries — Bug Hunter scan

> Context: Cross-cutting low-level utilities — caching, logging, env parsing, rate limiting, URL/ID safety, API response shaping, dedupe and distribution math.
> Files reviewed: 21 of 21
> Total: 7 findings — Critical: 0, High: 3, Medium: 3, Low: 1

## 1. Per-IP rate limiter is trivially bypassed via a spoofed `x-forwarded-for`

- **Severity**: High
- **Category**: trust-boundary / abuse-containment
- **File**: `app/_lib/rate-limit.ts:40` (`clientIpFrom`), used at `app/api/offer/[token]/route.ts:23`, `app/api/schedule/[token]/route.ts:89`, `app/api/schedule/invite/route.ts:20`, `app/api/apply/[id]/route.ts:195`, `app/api/channels/inbound/[token]/route.ts:48`, `app/api/demo/route.ts:22`
- **Scenario**: An abuser POSTs to a public side-effect route (offer confirm, schedule invite, apply, inbound channel) and sets a fresh `x-forwarded-for: <random-ip>` header on each request. `clientIpFrom` blindly returns the *first* XFF hop, so every request produces a new rate-limit key and the fixed-window cap (e.g. `limit: 10/min`, invite `30/min`) never trips.
- **Root cause**: `x-forwarded-for` is fully attacker-controlled unless a *trusted* proxy overwrites it. The helper takes the leftmost hop (the value a client can forge) with no notion of how many trusted proxy hops to strip, so the "per-IP" key degrades to "per-request-the-attacker-chooses". The code comment acknowledges the caveat but the routes still rely on it as their only throttle. Routes that fold the token into the key (`offer:${ip}:${token}`) are worse: rotating the spoofed IP also rotates the key, so even a single stolen token can be hammered without limit.
- **Impact**: The whole point of idea-3e49abaf (flood-protect candidate-email dispatch and provider cost) is defeated. An attacker floods candidate notifications, runs up comms-provider spend, and amplifies DB writes on the inbound-channel intake — exactly the abuse the limiter was added to contain.
- **Fix sketch**: Trust XFF only behind a known proxy: read a fixed number of *rightmost* hops (`TRUSTED_PROXY_HOPS`) instead of the leftmost, or prefer a platform-provided trusted header (e.g. the host's real connecting IP). For token routes, key the limit on the *token alone* (and a coarse global), not `ip:token`, so a spoofed IP can't multiply a single token's budget. Document that without a trusted proxy the per-IP guard is best-effort and add a global ceiling per route as a backstop.

## 2. `assertPublicHttpsEndpoint` only vets the literal host — DNS rebinding to a private IP still pivots SSRF

- **Severity**: High
- **Category**: ssrf / trust-boundary
- **File**: `app/_lib/safe-url.ts:82` (`assertPublicHttpsEndpoint`), `app/_lib/safe-url.ts:65` (`isIpLiteralHost`)
- **Scenario**: An operator (or an attacker who can write the LLM/Azure endpoint config) stores `https://metadata.attacker.com`. It passes every check — it's `https:`, not a bare IP, not `localhost`/`.local`/`.internal`. At fetch time the server resolves it; the attacker's DNS returns `169.254.169.254` (or `127.0.0.1`). The bearer key is sent to the cloud-metadata endpoint / a loopback service.
- **Root cause**: The guard validates the *string* host, never the *resolved* address. The doc comment claims it "closes 169.254.169.254 metadata, 127.x loopback and every RFC-1918 LAN in one rule," but that's only true for literal-IP hosts — a DNS name that resolves to those ranges sails through. (Note: I verified Node's WHATWG `URL` already normalizes decimal/hex/octal IPv4 (`2130706433`, `0x7f000001`, `0177.0.0.1`) and IPv4-mapped IPv6 back to forms the existing checks catch, so the gap is specifically the resolve-time one, not encoding tricks.)
- **Impact**: Server-side request forgery + provider-key exfiltration to an internal/metadata target — the exact pivot the function exists to stop, reachable by anyone who can set the endpoint.
- **Fix sketch**: Resolve the host at validation time (and again, ideally, pin the resolved IP through to the fetch) and reject if any A/AAAA record falls in loopback/link-local/RFC-1918/ULA ranges; or fetch through an egress proxy/allowlist of provider domains. At minimum, document that the string check is not rebinding-safe so callers don't over-trust it.

## 3. `dedupe`/`dedupeBy` collapse list rows on exact string identity only — near-duplicate model output still double-renders and can still collide as a React key

- **Severity**: Medium
- **Category**: edge-case / silent-failure
- **File**: `app/_lib/dedupe.ts:10` (`dedupe`), `app/_lib/dedupe.ts:19` (`dedupeBy`)
- **Scenario**: LLM analysis emits `"React"` and `"react "` (trailing space / different case), or the same skill with a combining-accent vs precomposed form. `new Set` treats them as distinct, so both survive. The stated purpose — "duplicate … collides as a React key, so React drops or mis-reconciles nodes" — is only partially met: visually-identical rows persist and, where callers later normalize for the `key` prop, two rows can still resolve to the *same* React key and trip the very reconciliation bug this helper was written to prevent.
- **Root cause**: De-dup identity (`===` via `Set`) and the eventual render/key identity are not the same normalization. The helper de-dupes on raw bytes while the UI's notion of "same item" is case/whitespace/Unicode-insensitive.
- **Impact**: Duplicate strengths/gaps/skills/sources shown to recruiters; intermittent React key collisions binding hover/tooltip state to the wrong row — the documented failure mode, not fully closed.
- **Fix sketch**: Offer a normalized variant (`trim().toLowerCase().normalize("NFC")`) as the default identity for these display lists, or have callers pass a normalizing `key` to `dedupeBy`. Whatever normalization de-dup uses must be the same one used to derive the React `key`.

## 4. `chunk(arr, size<=0)` silently returns the *entire* array as one chunk — defeats the SQLite-variable cap it exists to enforce

- **Severity**: Medium
- **Category**: edge-case / unsafe-default
- **File**: `app/_lib/entries-param.ts:49` (`chunk`)
- **Scenario**: A caller passes a misconfigured or computed `size` of `0` or a negative number (e.g. a future tunable that reads `0`). `chunk` returns `[arr]` — one chunk containing all N ids — which is then expanded into a single `IN (?,?,…)` with N bound variables. With a large `entries=` list this re-introduces exactly the `SQLITE_MAX_VARIABLE_NUMBER` overflow the module was built to prevent.
- **Root cause**: The `size <= 0` branch chose "return everything in one chunk" as its safe default, but for an `IN`-width bounder the safe default is the opposite: never emit a chunk wider than the floor. The guard turns a config mistake into the failure it's guarding against, silently.
- **Impact**: A prepared-statement throw → 500 on the interview-prep / by-entry batch reads, and a latent amplification vector if `size` is ever derived rather than the hard-coded `SQL_IN_CHUNK`. Today `SQL_IN_CHUNK = 400` is hard-coded so it doesn't bite, but the helper is generic and shared.
- **Fix sketch**: Treat `size <= 0` as a programming error: throw, or clamp to a sane minimum (e.g. `Math.max(1, size)`) so an out-of-range size still chunks at width 1 rather than emitting an unbounded chunk. Add a test for `size <= 0`.

## 5. Fixed-window limiter allows a 2× burst across the window boundary

- **Severity**: Medium
- **Category**: race-condition / rate-limit
- **File**: `app/_lib/rate-limit.ts:21` (`rateLimit`)
- **Scenario**: With `limit: 10/60s`, a caller spends all 10 hits at t=59s, then the window resets at t=60s and they spend 10 more at t=61s — 20 requests in ~2 seconds, double the intended rate at the seam. Standard fixed-window weakness.
- **Root cause**: A hard window reset (`w.resetAt <= nowMs` → fresh `count: 1`) has no memory of the prior window, so traffic clustered at the boundary is admitted twice. The limiter promises a per-window cap but the *effective* short-interval rate is up to 2× the configured ceiling.
- **Impact**: On the candidate-email dispatch routes this means burstable flooding/cost at up to twice the nominal cap — partial erosion of the same protection as #1, even by a non-spoofing caller.
- **Fix sketch**: Use a sliding-window-counter (weight the previous window by the fraction of it still in view) or a token bucket. Both bound the true short-interval rate. Keep the injectable `nowMs` so the existing tests still drive it.

## 6. Module-global `lastSweepAt` mixes injected test clocks with the real wall clock — a tiny `nowMs` can disable the sweep for ~real-time

- **Severity**: Medium
- **Category**: latent-failure / state-corruption
- **File**: `app/_lib/rate-limit.ts:16` (`lastSweepAt`), `app/_lib/rate-limit.ts:23` (sweep guard)
- **Scenario**: `lastSweepAt` is a process-global set to the last `nowMs` seen. If any caller ever passes a non-`Date.now()` value larger than the real clock (a future-dated `nowMs`, a test that leaks into a shared process, or clock skew), the guard `nowMs - lastSweepAt > 60_000` stays false for real subsequent requests, so the lazy sweep stops running and abandoned one-shot-token windows accumulate unbounded. Conversely a past-dated `nowMs` forces a sweep every call.
- **Root cause**: One shared mutable cursor is compared against a clock the caller controls. The limiter assumes a single monotonic time source, but `nowMs` is an injectable parameter (used by tests) layered over the same global state as production.
- **Impact**: Slow unbounded memory growth of the `windows` Map (the sweep is the only reclaim path) under clock anomalies — a quiet leak on a long-lived single server process. Low likelihood in prod, but the design couples test-controlled input to production reclamation.
- **Fix sketch**: Sweep on the real clock independent of the per-call `nowMs` (e.g. drive the sweep cursor from an internal `Date.now()` only), or store sweep state per-store-instance and construct a fresh limiter for tests. Never let an injected time advance/retard the reclamation cursor.

## 7. `readTextWithLimit` decodes with a non-fatal `TextDecoder`, so malformed/truncated UTF-8 silently becomes replacement chars rather than a clear reject

- **Severity**: Low
- **Category**: silent-failure / edge-case
- **File**: `app/_lib/request-body.ts:35` (`new TextDecoder().decode(merged)`)
- **Scenario**: The inbound-channel route (`app/api/channels/inbound/[token]/route.ts:73`) reads an attacker- or partner-supplied body. A body with invalid UTF-8 byte sequences decodes to U+FFFD replacement characters instead of failing; downstream JSON/parse logic then works on subtly corrupted text (a truncated multi-byte char at the exact `maxBytes` cutoff is the common case, since the limiter aborts mid-stream).
- **Root cause**: Default `TextDecoder` is lenient (`fatal: false`, no BOM handling). For a hard trust boundary, silent lossy decoding hides malformed input rather than surfacing it.
- **Impact**: Corrupted inbound payloads parse "successfully" into garbled fields; a body truncated at the byte cap can split a UTF-8 sequence and mangle the last token without any signal.
- **Fix sketch**: Decode with `new TextDecoder("utf-8", { fatal: true })` and return `null` (→ 400/413) on a decode error, mirroring the over-limit `null` contract. Optionally strip a leading BOM. Add a test for an invalid-UTF-8 body and a boundary-split multibyte char.
